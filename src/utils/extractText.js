/**
 * 从消息 content 中提取纯文本字符串
 *
 * LangChain 的 BaseMessage.content 类型为 string | MessageContentComplex[]:
 *   - 纯文本场景 → "这是一段回复"
 *   - 多模态/结构化场景 → [{ type: "text", text: "..." }, { type: "image_url", ... }]
 *
 * MCP 远程工具和某些模型可能返回数组格式，直接当字符串用会得到 "[object Object]"。
 * 本函数统一处理两种形态，始终返回干净的纯文本。
 *
 * @param {string | Array<{type: string, text?: string}> | null | undefined} content
 * @returns {string}
 */
export function extractText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text)
      .join('');
  }

  // null / undefined / 其他类型 → 兜底
  return String(content ?? '');
}
