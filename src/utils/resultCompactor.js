/**
 * 工具结果处理 — 纯函数集，两个方向：
 *   1. compactToolResult → 截断后发给模型（省 token）
 *   2. summarizeResult   → 一行摘要给终端显示
 */

// ============================================================
//  公开入口
// ============================================================

/**
 * 截断工具结果，减少发送给模型的 token 数
 * @param {string} toolName
 * @param {string} result
 * @returns {string}
 */
export function compactToolResult(toolName, result) {
  if (typeof result !== 'string') return result;

  if (toolName === 'read_file')    return _truncateFile(result);
  if (toolName === 'exec_command') return _truncateCommand(result);
  return _truncateGeneral(result);
}

/**
 * 工具结果 → 终端一行摘要
 * @param {string} toolName
 * @param {string} result
 * @returns {string}
 */
export function summarizeToolResult(toolName, result) {
  if (toolName === 'read_file' || toolName === 'write_file') {
    return `${typeof result === 'string' ? result.length : 0} 字符`;
  }
  if (toolName === 'list_directory') {
    const match = result.match(/\((\d+) 项\)/);
    return match ? `${match[1]} 项` : '';
  }
  if (toolName === 'exec_command') {
    // 结果现在是多行的（首行状态 + stdout/stderr 段），摘要只取首行
    const firstLine = result.split('\n')[0];
    return firstLine.length > 60 ? firstLine.slice(0, 60) + '...' : firstLine;
  }
  if (typeof result === 'string') {
    return result.length > 50 ? result.slice(0, 50) + '...' : result;
  }
  return '';
}

// ============================================================
//  内部截断策略（不导出）
// ============================================================

function _truncateFile(content) {
  const MAX_HEAD = 200;
  const MAX_TAIL = 20;
  const lines = content.split('\n');
  if (lines.length <= MAX_HEAD + MAX_TAIL + 10) return content;

  const skipped = lines.length - MAX_HEAD - MAX_TAIL;
  return [
    lines.slice(0, MAX_HEAD).join('\n'),
    '',
    `... (省略中间 ${skipped} 行 / ${lines.length} 总行数) ...`,
    '',
    lines.slice(-MAX_TAIL).join('\n'),
  ].join('\n');
}

function _truncateCommand(output) {
  const MAX_HEAD = 20;
  const MAX_TAIL = 80;
  const lines = output.split('\n');
  if (lines.length <= MAX_HEAD + MAX_TAIL + 10) return output;

  const skipped = lines.length - MAX_HEAD - MAX_TAIL;
  return [
    lines.slice(0, MAX_HEAD).join('\n'),
    `... (省略中间 ${skipped} 行输出 / ${lines.length} 总行数) ...`,
    lines.slice(-MAX_TAIL).join('\n'),
  ].join('\n');
}

function _truncateGeneral(content) {
  const MAX = 5000;
  if (content.length <= MAX) return content;
  return content.slice(0, 3000) + `\n... (省略 ${content.length - 3000} 字符)`;
}
