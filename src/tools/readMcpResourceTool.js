import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * 创建 read_mcp_resource 工具 — 让模型按需读取 MCP 资源内容
 *
 * 设计思路:
 *   system prompt 中只放资源列表（名称 + URI + 描述），不放内容。
 *   模型判断某个资源对当前任务有用时，调用此工具按需读取。
 *   这避免了无关资源占用每轮对话的上下文窗口。
 *
 * @param {import('../mcp/client.js').McpClientManager} mcpManager
 * @returns {import('@langchain/core/tools').StructuredTool}
 */
export function createReadMcpResourceTool(mcpManager) {
  return tool(
    async ({ serverName, uri }) => {
      try {
        const contents = await mcpManager.readResource(serverName, uri);

        if (!contents || contents.length === 0) {
          return `资源 "${uri}" (服务器: ${serverName}) 返回了空内容。`;
        }

        // 拼接所有 content 项的文本
        const parts = [];
        for (const item of contents) {
          if (item.text) {
            parts.push(item.text);
          } else if (item.blob) {
            parts.push(`[二进制内容, ${item.blob.length} 字节, mimeType: ${item.mimeType || 'unknown'}]`);
          } else {
            parts.push(`[未知内容类型, uri: ${item.uri}]`);
          }
        }

        return parts.join('\n\n---\n\n');
      } catch (err) {
        return `读取 MCP 资源失败: ${err.message || err}\n\n服务器: ${serverName}\nURI: ${uri}\n\n可用的资源列表已列在 system prompt 中，请检查 URI 是否正确。`;
      }
    },
    {
      name: 'read_mcp_resource',
      description: `读取 MCP 服务器提供的资源内容。当你需要参考资源中的信息来完成任务时调用。

**使用前提**: 你已在 system prompt 末尾的"可用 MCP 资源"列表中看到了该资源。
**参数说明**:
- serverName: MCP 服务器名称（必须与资源列表中出现的名称完全一致）
- uri: 资源 URI（必须与资源列表中的 \`uri\` 字段完全一致）

**典型场景**:
- 任务涉及编码规范 → 读取相关规范文档资源
- 需要项目结构信息 → 读取项目文件资源
- 需要数据库表结构 → 读取 schema 资源`,
      schema: z.object({
        serverName: z.string().describe('MCP 服务器名称，与系统提示词中列出的资源所属服务器名称一致'),
        uri: z.string().describe('资源的 URI，与系统提示词资源列表中 \'...\' 内的值完全一致'),
      }),
    }
  );
}
