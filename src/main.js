import { createModel, config } from './config.js';
import { ReactAgent } from './agent/ReactAgent.js';
import { createSystemPrompt } from './prompts/systemPrompt.js';
import { tools } from './tools/index.js';
import { logger } from './utils/logger.js';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Demo 任务 — 无参数时的默认示例
const DEMO_TASK = `
创建一个功能丰富的React TodoList 应用：
1. 创建项目 ：echo -e "n\\n\\n" | pnpm create vite react-todo-app --template react-ts
2. 修改 src/App.tsx ,实现完整功能的TodoList:
- 添加、删除、标记完成
- 分类筛选（全部/进行中/已完成）
- 统计信息显示
- localStorage 数据持久化
3. 添加复杂样式
- 渐变背景（蓝到紫）
- 卡片阴影，圆角
- 悬停效果
4. 添加动画：
- 添加/删除时的过渡动画
- 使用css transitions
5. 列出目录确定

注意： 使用pnpm， 功能要完整， 样式要美观， 要有动画效果

之后 在react-todo-app 项目中：
1. 使用 pnpm install 安装依赖
2. 使用 pnpm run dev 启动服务器
`;

/**
 * 从命令行参数解析用户任务
 * 支持: node main.js "任务描述"  |  node main.js -f task.md  |  node main.js (交互式)
 */
async function parseTask() {
  const args = process.argv.slice(2);

  // 从文件读取
  if (args[0] === '-f' || args[0] === '--file') {
    const filePath = args[1];
    if (!filePath) {
      logger.error('请指定文件路径: node main.js -f task.md');
      process.exit(1);
    }
    try {
      return await readFile(filePath, 'utf8');
    } catch (e) {
      logger.error(`无法读取文件: ${filePath} — ${e.message}`);
      process.exit(1);
    }
  }

  // 命令行直接传入
  if (args.length > 0) {
    return args.join(' ');
  }

  // 无参数 → 交互式输入
  return interactivePrompt();
}

/**
 * 交互式输入 — readline 读取用户任务
 */
function interactivePrompt() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    console.log(''); // 空行直到读取到输入
    rl.question('📝 请输入任务 (回车使用 Demo): ', (answer) => {
      rl.close();
      resolve(answer.trim() || DEMO_TASK);
    });
  });
}

// ===== 主流程 =====
async function main() {
  const task = await parseTask();

  // 创建模型并绑定工具
  const model = createModel();
  const modelWithTools = model.bindTools(tools);

  // 创建 Agent
  const agent = new ReactAgent({
    model: modelWithTools,
    tools,
    systemPrompt: createSystemPrompt(process.cwd()),
    maxIterations: config.agent.maxIterations,
  });

  // 启动
  logger.agentStart(task);

  try {
    await agent.run(task);
  } catch (e) {
    logger.error(`${e.message || e}`);
    process.exit(1);
  }
}

main();
