import chalk from 'chalk';

/**
 * 统一日志工具 — 封装 chalk，提供一致的终端输出格式
 */
export const logger = {
  /** 阶段标题：━━━ 第 3/10 轮 ━━━ */
  phase(msg) {
    console.log(chalk.magenta.bold(`\n━━━ ${msg} ━━━`));
  },

  /** 模型请求调用工具时的概览 */
  toolPlan(toolCalls) {
    console.log(chalk.cyan.bold(`\n📋 模型请求调用 ${toolCalls.length} 个工具:`));
    for (const tc of toolCalls) {
      console.log(chalk.cyan(`  → ${tc.name}`));
      if (tc.args) {
        for (const [key, value] of Object.entries(tc.args)) {
          const display = typeof value === 'string' && value.length > 80
            ? value.slice(0, 80) + '...'
            : value;
          console.log(chalk.gray(`      ${key}: ${display}`));
        }
      }
    }
  },

  /** 工具执行中（开始执行时） */
  toolStart(name, args) {
    const shortArgs = {};
    for (const [k, v] of Object.entries(args || {})) {
      shortArgs[k] = typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '...' : v;
    }
    console.log(chalk.yellow(`  ⚡ ${name}`) + chalk.gray(` ${JSON.stringify(shortArgs)}`));
  },

  /** 工具执行成功 */
  toolSuccess(name, duration, summary) {
    console.log(chalk.green(`  ✔ ${name}`) + chalk.gray(` (${duration}ms)`) + (summary ? chalk.green(` → ${summary}`) : ''));
  },

  /** 工具执行失败 */
  toolFail(name, duration, reason) {
    console.log(chalk.red(`  ✖ ${name}`) + chalk.gray(` (${duration}ms)`) + chalk.red(` → ${reason}`));
  },

  /** Agent 最终回复 */
  agentReply(content) {
    console.log(chalk.blue.bold('\n🤖 Agent 最终回复:'));
    console.log(chalk.blue(content));
  },

  /** Agent 启动 */
  agentStart(task) {
    console.log(chalk.green.bold('\n🚀 Agent 启动'));
    console.log(chalk.gray(`📝 任务: ${task.length > 100 ? task.slice(0, 100) + '...' : task}`));
  },

  /** Agent 完成 */
  agentDone() {
    console.log(chalk.green.bold('\n✅ Agent 执行完成!\n'));
  },

  /** 错误 */
  error(msg) {
    console.error(chalk.red.bold(`\n❌ ${msg}`));
  },

  /** 警告 */
  warn(msg) {
    console.log(chalk.yellow(`\n⚠️  ${msg}`));
  },

  /** 达到最大迭代次数 */
  maxIterations(current) {
    console.log(chalk.yellow(`\n⚠️  达到最大迭代次数 (${current})，返回最后一条消息`));
  },
};
