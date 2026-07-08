import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { logger } from '../utils/logger.js';

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
  constructor({ model, tools, systemPrompt, maxIterations = 15 }) {
    this.model = model;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
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

    for (let i = 0; i < this.maxIterations; i++) {
      const iterStart = Date.now();
      logger.phase(`第 ${i + 1}/${this.maxIterations} 轮 (累计 ${((Date.now() - startTime) / 1000).toFixed(1)}s)`);

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
          const summary = this._summarizeResult(toolCall.name, toolResult);
          logger.toolSuccess(toolCall.name, toolDuration, summary);
        }

        messages.push(
          new ToolMessage({
            content: toolResult,
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
   * 为工具结果生成简短摘要（用于终端显示，不返回模型）
   */
  _summarizeResult(toolName, result) {
    if (toolName === 'read_file' || toolName === 'write_file') {
      return `${typeof result === 'string' ? result.length : 0} 字符`;
    }
    if (toolName === 'list_directory') {
      const match = result.match(/\((\d+) 项\)/);
      return match ? `${match[1]} 项` : '';
    }
    if (toolName === 'exec_command') {
      return result.length > 60 ? result.slice(0, 60) + '...' : result;
    }
    return '';
  }
}
