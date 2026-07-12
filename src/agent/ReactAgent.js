import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { logger } from '../utils/logger.js';
import { countTokens } from '../utils/tokenCounter.js';
import { compactToolResult, summarizeToolResult } from '../utils/resultCompactor.js';

/**
 * ReAct Agent — 封装 Reasoning + Acting 循环
 *
 * 用法:
 *   const agent = new ReactAgent({ model, tools, systemPrompt, maxIterations });
 *   const result = await agent.run("你的任务描述");
 */
export class ReactAgent {
  /**
   * @param {object} opts
   * @param {ChatOpenAI} opts.model          - 已绑定工具的 LangChain 模型实例
   * @param {Tool[]}    opts.tools           - LangChain tool 数组
   * @param {string}    opts.systemPrompt    - System prompt 文本
   * @param {number}    opts.maxIterations   - 最大迭代次数 (默认 15)
   */
  constructor({ model, tools, systemPrompt, maxIterations = 15, contextLimit = 100_000 }) {
    this.model = model;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.contextLimit = contextLimit;
  }

  /**
   * 执行 ReAct 循环
   * @param {string} userQuery - 用户任务描述
   * @returns {Promise<string>} Agent 最终回复文本
   */
  async run(userQuery) {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(userQuery),
    ];

    const startTime = Date.now();

    const CONTEXT_LIMIT = this.contextLimit || 100_000; // 留 28K 给模型输出

    for (let i = 0; i < this.maxIterations; i++) {
      const iterStart = Date.now();
      logger.phase(`第 ${i + 1}/${this.maxIterations} 轮 (累计 ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

      // --- Token 守护 ---
      const usedTokens = countTokens(messages);
      logger.log(`📊 上下文 token: ${usedTokens} / ${CONTEXT_LIMIT}`);

      // 第一级：80% 软压缩（语义摘要）
      if (usedTokens > CONTEXT_LIMIT * 0.8) {
        logger.warn(`⚠️ 上下文 ${usedTokens} tokens → 触发语义压缩`);
        messages = this._compactMessages(messages);
        const after = countTokens(messages);
        logger.log(`📊 压缩后: ${after} tokens`);

        // 第二级：95% 硬截断兜底 — 语义摘要不够，直接丢旧消息
        if (after > CONTEXT_LIMIT * 0.95) {
          logger.warn(`⚠️ 压缩后仍 ${after} tokens → 触发硬截断`);
          messages = this._hardTruncate(messages);
          logger.log(`📊 硬截断后: ${countTokens(messages)} tokens`);
        }
      }

      // --- 调用模型 ---
      const response = await this.model.invoke(messages);
      messages.push(new AIMessage(response));

      // --- 模型返回文本 → 任务完成 ---
      if (!response.tool_calls || response.tool_calls.length === 0) {
        logger.agentReply(response.content);
        logger.agentDone();
        return response.content;
      }

      // --- 模型请求调用工具 ---
      logger.toolPlan(response.tool_calls);

      // 逐个执行工具（串行以保证输出可读）
      for (const toolCall of response.tool_calls) {
        const tool = this.tools.find((t) => t.name === toolCall.name);

        if (!tool) {
          // 模型请求了不存在的工具 → 返回错误消息让模型知道
          const errMsg = `工具 "${toolCall.name}" 不存在。可用工具: ${this.tools.map((t) => t.name).join(', ')}`;
          logger.toolFail(toolCall.name, 0, '工具不存在');
          messages.push(
            new ToolMessage({ content: errMsg, tool_call_id: toolCall.id }),
          );
          continue;
        }

        // 执行工具 — 所有错误都 catch，作为 ToolMessage 返回给模型
        const toolStart = Date.now();
        logger.toolStart(toolCall.name, toolCall.args);

        let toolResult;
        try {
          toolResult = await tool.invoke(toolCall.args);
        } catch (err) {
          toolResult = `工具执行出错: ${err.message || err}`;
        }

        const toolDuration = Date.now() - toolStart;
        const isError = typeof toolResult === 'string' && toolResult.startsWith('工具执行出错');

        if (isError) {
          logger.toolFail(toolCall.name, toolDuration, toolResult);
        } else {
          // 生成结果摘要
          const summary = summarizeToolResult(toolCall.name, toolResult);
          logger.toolSuccess(toolCall.name, toolDuration, summary);
        }

        messages.push(
          new ToolMessage({
            content: compactToolResult(toolCall.name, toolResult),
            tool_call_id: toolCall.id,
          }),
        );
      }
    }

    // 达到最大迭代次数
    logger.maxIterations(this.maxIterations);
    logger.agentDone();
    return messages[messages.length - 1].content;
  }

  /**
   * 压缩消息历史：保留 system prompt + 最近 6 条，中间提取语义摘要
   *
   * 对于中间被压缩的消息，按类型提取有意义的信息：
   *   AIMessage(含 tool_calls) → 调用了哪些工具 + 参数概要
   *   ToolMessage               → 工具名 + 执行结果（成功/失败/关键数字）
   *   AIMessage(纯文本)         → 模型回复的前 80 字符
   *   HumanMessage              → 用户输入的前 80 字符
   *
   * @param {import('@langchain/core/messages').BaseMessage[]} messages
   * @returns {import('@langchain/core/messages').BaseMessage[]}
   */
  _compactMessages(messages) {
    const KEEP_TAIL = 6;

    if (messages.length <= KEEP_TAIL + 2) {
      return messages;
    }

    const systemMsg = messages[0];
    const middle = messages.slice(1, -KEEP_TAIL);
    const recent = messages.slice(-KEEP_TAIL);

    const summaryLines = middle
      .map((m) => this._summarizeMessage(m))
      .filter(Boolean);

    const summary = summaryLines.length > 0
      ? `[上下文压缩 — 以下为中间 ${summaryLines.length} 条消息的概要]\n${summaryLines.join('\n')}`
      : '[上下文压缩 — 中间消息已移除]';

    return [
      systemMsg,
      new HumanMessage(summary),
      ...recent,
    ];
  }

  /**
   * 将单条消息提取为一行语义摘要
   * @param {import('@langchain/core/messages').BaseMessage} msg
   * @returns {string|null}
   */
  _summarizeMessage(msg) {
    const content = String(msg.content || '');

    // AIMessage — 区分 "调用工具" 和 "纯文本回复"
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const calls = msg.tool_calls
        .map((tc) => {
          const argsStr = JSON.stringify(tc.args);
          const shortArgs = argsStr.length > 50 ? argsStr.slice(0, 50) + '…' : argsStr;
          return `${tc.name}(${shortArgs})`;
        })
        .join(', ');
      return `🔧 调用: ${calls}`;
    }

    if (msg._getType?.() === 'ai' && content) {
      return `💬 ${content.slice(0, 80)}`;
    }

    // ToolMessage — 提取工具名 + 结果摘要（不显示完整内容）
    if (msg._getType?.() === 'tool') {
      return this._summarizeToolResult(content);
    }

    // HumanMessage
    if (msg._getType?.() === 'human' && content) {
      return `👤 ${content.slice(0, 80)}`;
    }

    // 兜底
    if (content) {
      return `[${msg._getType?.() || '?'}] ${content.slice(0, 60)}`;
    }

    return null;
  }

  /**
   * 从 ToolMessage 的原始内容提取一句话摘要
   * @param {string} content - 工具返回的原始字符串
   * @returns {string}
   */
  _summarizeToolResult(content) {
    // read_file
    if (content.startsWith('读取文件')) {
      return `📄 ${content.split('\n')[0]}`;  // "读取文件 xxx 失败: ..." 或正常内容首行
    }
    if (content.includes('import ') || content.includes('export ') || content.includes('require(')) {
      const lines = content.split('\n').length;
      return `📄 read_file 结果: ${lines} 行代码`;
    }

    // write_file
    const writeMatch = content.match(/^成功写入 (.+?) \((\d+) 字节\)/);
    if (writeMatch) {
      return `✍️ 写入 ${writeMatch[1]} (${writeMatch[2]} 字节)`;
    }
    if (content.startsWith('写入文件')) {
      return `✍️ ${content.split('\n')[0]}`;
    }

    // exec_command
    const execMatch = content.match(/^命令执行(成功|失败): (.+)/);
    if (execMatch) {
      const status = execMatch[1] === '成功' ? '✅' : '❌';
      return `${status} 执行: ${execMatch[2].slice(0, 60)}`;
    }
    if (content.startsWith('命令执行异常')) {
      return `❌ ${content.slice(0, 60)}`;
    }

    // list_directory
    if (content.startsWith('目录内容')) {
      const countMatch = content.match(/\((\d+) 项\)/);
      return countMatch ? `📁 列出 ${countMatch[1]} 项` : `📁 ${content.split('\n')[0]}`;
    }
    if (content.startsWith('读取目录')) {
      return `📁 ${content.slice(0, 50)}`;
    }

    // MCP 资源
    if (content.startsWith('资源 "')) {
      return `📦 MCP 资源: ${content.slice(0, 80)}`;
    }

    // 兜底
    return `📋 ${content.slice(0, 60)}`;
  }

  /**
   * 硬截断：只保留 system prompt + 最近 4 条消息，其余丢弃
   *
   * 这是最后的兜底 —— 语义压缩后 token 仍然超标时触发。
   * 此时宁可丢失上下文也不能让 API 调用失败。
   *
   * @param {import('@langchain/core/messages').BaseMessage[]} messages
   * @returns {import('@langchain/core/messages').BaseMessage[]}
   */
  _hardTruncate(messages) {
    const KEEP_TAIL = 4;
    if (messages.length <= KEEP_TAIL + 2) return messages;

    const dropped = messages.length - KEEP_TAIL - 1;
    return [
      messages[0],
      new HumanMessage(`[硬截断 — 丢弃了中间 ${dropped} 条消息，仅保留最近 ${KEEP_TAIL} 条]`),
      ...messages.slice(-KEEP_TAIL),
    ];
  }
}
