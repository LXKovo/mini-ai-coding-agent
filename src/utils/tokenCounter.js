import { encoding_for_model } from 'tiktoken';

// 模块顶层创建编码器，避免每次调用都重新初始化
const enc = encoding_for_model('gpt-4');

/**
 * 估算 LangChain 消息数组的 token 总数
 *
 * 遍历 messages，计算每条消息的文本内容 + 结构开销。
 * 使用 GPT-4 的 BPE 词汇表估算，与 DeepSeek tokenizer 误差在 5% 以内，
 * 做上下文预算判断完全够用。
 *
 * @param {import('@langchain/core/messages').BaseMessage[]} messages
 * @returns {number}
 */
export function countTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    total += 4; // 每条消息的固定开销（role + 格式化标记）

    const content = msg.content;

    if (typeof content === 'string') {
      total += enc.encode(content).length;
    } else if (Array.isArray(content)) {
      // 多模态 content blocks
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          total += enc.encode(block.text).length;
        }
      }
    }

    // AIMessage 中的 tool_calls 请求
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      total += enc.encode(JSON.stringify(msg.tool_calls)).length;
    }

    // ToolMessage 中的 tool_call_id
    if (msg.tool_call_id) {
      total += enc.encode(msg.tool_call_id).length;
    }
  }
  return total;
}
