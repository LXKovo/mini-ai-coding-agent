import chalk from 'chalk';

/**
 * 统一日志工具 — 封装 chalk，提供一致的终端输出格式
 */
export const logger = {
  /** 阶段标题：━━━ 第 3/10 轮 ━━━ */
  phase(msg) {
    console.log(chalk.magenta.bold(`\n━━━ ${msg} ━━━`));
  },

  /** 模型请求调用工具时的概览 — 只显示工具名，不展开参数 */
  toolPlan(toolCalls) {
    const names = toolCalls.map((tc) => tc.name).join(', ');
    console.log('');
    console.log(chalk.cyan(`📋 调用: ${names}`));
  },

  /** 工具执行中（开始执行时）— 极简，只标状态 */
  toolStart(name, _args) {
    process.stdout.write(chalk.yellow(`  ⚡ ${name} `));
  },

  /** 工具执行成功 */
  toolSuccess(name, duration, summary) {
    console.log(chalk.green(`  ✔ ${name}`) + chalk.gray(` (${duration}ms)`) + (summary ? chalk.green(` → ${summary}`) : ''));
  },

  /** 工具执行失败 */
  toolFail(name, duration, reason) {
    console.log(chalk.red(`  ✖ ${name}`) + chalk.gray(` (${duration}ms)`) + chalk.red(` → ${reason}`));
  },

  /**
   * 子进程输出的实时透传
   *
   * exec_command 用 pipe 捕获输出（否则模型看不到命令结果），捕获到的内容
   * 同时原样转发到这里，保证终端仍然能实时看到进度。不加任何 chalk 修饰
   * ——这是命令自己的输出，不是我们的日志。
   */
  commandOutput(text) {
    process.stdout.write(text);
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

  /** 普通信息 */
  log(msg) {
    console.log(chalk.gray(msg));
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
