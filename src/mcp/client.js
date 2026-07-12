import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

/**
 * 把 Zod 校验错误转成人类可读的一句话
 * 原始错误可能包含完整的 JSON ZodError，信息量巨大但对用户无用
 */
function _formatMcpError(error, servers) {
  // Zod validation error — 配置字段不对（比如 transport 写成了 streamableHttp）
  if (error.name === 'ZodError' || (error.message && error.message.includes('invalid'))) {
    try {
      const details = JSON.parse(error.message);
      if (Array.isArray(details)) {
        const names = details
          .map((d) => d.path?.slice(-1)[0])
          .filter(Boolean);
        return `配置格式错误: ${names.map((n) => `"${n}"`).join('、')} — transport 只支持 "stdio" 或 "http"`;
      }
    } catch (_) { /* 不是 JSON，用原始信息 */ }
  }

  // 普通连接错误 — 截取前 120 字符
  const msg = error.message || String(error);
  return msg.length > 120 ? msg.slice(0, 120) + '...' : msg;
}

/**
 * MCP 客户端封装 — 管理多服务器连接，合并 MCP 工具与本地工具
 *
 * 用法:
 *   const mcp = await initMcpClient();
 *   const tools = await mcp.getTools(localTools);
 *   // ... 使用 tools 运行 Agent ...
 *   await mcp.close();
 */
export class McpClientManager {
  #client = null;// MCP 客户端实例
  #connected = false;// 是否已连接

  /**
   * 初始化 MCP 连接
   * @param {object} opts
   * @param {Record<string, object>} opts.servers - MCP 服务器配置
   * @param {boolean} opts.prefixToolName - 是否为工具名添加服务器前缀
   */
  async init({ servers = {}, prefixToolName = true } = {}) {
    const serverNames = Object.keys(servers);

    if (serverNames.length === 0) {
      logger.log('[MCP] 未配置 MCP 服务器，仅使用本地工具');
      this.#connected = false;
      return this;
    }

    logger.log(`[MCP] 连接 ${serverNames.length} 个服务器: ${serverNames.join(', ')}`);

    try {
      this.#client = new MultiServerMCPClient({
        mcpServers: servers,
      });

      // 初始化所有连接，加载各服务器的工具
      const toolsByServer = await this.#client.initializeConnections();

      let totalMcpTools = 0;
      for (const [name, tools] of Object.entries(toolsByServer)) {
        logger.log(`[MCP]   ✓ ${name}: ${tools.length} 个工具`);
        totalMcpTools += tools.length;
      }

      this.#connected = totalMcpTools > 0;
      logger.log(`[MCP] 共加载 ${totalMcpTools} 个 MCP 工具`);
    } catch (e) {
      logger.warn(`[MCP] 连接失败: ${_formatMcpError(e, servers)}`);
      this.#connected = false;
    }

    return this;
  }

  /**
   * 获取合并后的工具列表（本地 + MCP，本地优先，自动去重）
   * @param {import('@langchain/core/tools').StructuredTool[]} localTools - 本地工具数组
   * @returns {Promise<import('@langchain/core/tools').StructuredTool[]>}
   */
  async getTools(localTools = []) {
    if (!this.#connected || !this.#client) {
      return localTools;
    }

    try {
      const mcpTools = await this.#client.getTools();
      const localNames = new Set(localTools.map((t) => t.name));

      // 过滤掉与本地工具重名的 MCP 工具（本地工具优先，无路径限制）
      const newMcpTools = mcpTools.filter((t) => !localNames.has(t.name));
      const skipped = mcpTools.length - newMcpTools.length;

      if (skipped > 0) {
        const skippedNames = mcpTools
          .filter((t) => localNames.has(t.name))
          .map((t) => t.name)
          .join(', ');
        logger.log(`[MCP] 跳过 ${skipped} 个重名工具 (本地优先): ${skippedNames}`);
      }

      return [...localTools, ...newMcpTools];
    } catch (e) {
      logger.warn(`[MCP] 获取 MCP 工具失败: ${e.message}`);
      return localTools;
    }
  }

  /**
   * 获取某个 MCP 服务器的原始客户端（用于 resources/prompts 操作）
   * @param {string} serverName
   */
  async getClient(serverName) {
    if (!this.#client) return null;
    return this.#client.getClient(serverName);
  }

  /**
   * 列出所有 MCP 服务器的资源
   * @returns {Promise<Record<string, Array<{uri: string, name: string, description?: string, mimeType?: string}>>>}
   */
  async getResources() {
    if (!this.#connected || !this.#client) {
      return {};
    }

    try {
      const resources = await this.#client.listResources();
      let total = 0;
      for (const list of Object.values(resources)) {
        total += list.length;
      }
      logger.log(`[MCP] 共发现 ${total} 个 MCP 资源`);
      return resources;
    } catch (e) {
      logger.warn(`[MCP] 获取 resources 失败: ${e.message}`);
      return {};
    }
  }

  /**
   * 读取指定服务器的某个资源内容
   * @param {string} serverName - MCP 服务器名称
   * @param {string} uri - 资源 URI
   * @returns {Promise<Array<{uri: string, mimeType?: string, text?: string, blob?: string}>>}
   */
  async readResource(serverName, uri) {
    if (!this.#connected || !this.#client) {
      return null;
    }

    try {
      return await this.#client.readResource(serverName, uri);
    } catch (e) {
      logger.warn(`[MCP] 读取 resource 失败 (${serverName}: ${uri}): ${e.message}`);
      return null;
    }
  }

  /**
   * 关闭所有 MCP 连接
   */
  async close() {
    if (this.#client) {
      try {
        await this.#client.close();
        logger.log('[MCP] 连接已关闭');
      } catch (e) {
        // 静默关闭
      }
    }
    this.#connected = false;
  }

  /** 是否有活跃的 MCP 连接 */
  get isConnected() {
    return this.#connected;
  }
}

/**
 * 便捷函数 — 直接创建并初始化 MCP 客户端
 */
export async function initMcpClient(options) {
  const manager = new McpClientManager();
  return manager.init(options);
}

/**
 * 从 MCP 服务器获取资源并构建为系统提示词可用的上下文字符串
 *
 * 流程:
 *   1. 调用 listResources 获取所有服务器的资源列表（轻量，只含 URI + 名称 + 描述）
 *   2. 对每个文本类资源（mimeType 含 text/ 或无 mimeType），读取其内容
 *   3. 将所有资源内容格式化为 markdown 风格的上下文文本
 *
 * @param {McpClientManager} mcpManager - 已初始化的 MCP 客户端管理器
 * @param {object} [opts]
 * @param {number} [opts.maxResourceSize=8000] - 单个资源内容的最大字符数（超出截断）
 * @param {number} [opts.maxTotalSize=50000] - 所有资源内容的总字符数上限（超出停止读取）
 * @param {boolean} [opts.preRead=false] - 是否预读取资源内容（false 则只列出名称+URI+描述，模型通过 read_mcp_resource 工具按需读取）
 * @returns {Promise<string>} 格式化的资源上下文字符串，无资源时返回空字符串
 */
export async function buildResourcesContext(mcpManager, opts = {}) {
  const {
    maxResourceSize = 8000,
    maxTotalSize = 50000,
    preRead = false,
  } = opts;

  const resourcesByServer = await mcpManager.getResources();
  const servers = Object.keys(resourcesByServer);

  if (servers.length === 0) return '';

  // 构建资源清单
  const sections = [];
  let totalSize = 0;

  for (const serverName of servers) {
    const resources = resourcesByServer[serverName];
    if (resources.length === 0) continue;

    const lines = [];
    lines.push(`### ${serverName} (${resources.length} 个资源)`);
    lines.push('');

    for (const resource of resources) {
      const label = resource.description
        ? `- **${resource.name || resource.uri}**: ${resource.description}`
        : `- **${resource.name || resource.uri}**`;
      lines.push(`${label}  (\`${resource.uri}\`)`);

      // 预读取文本类资源内容
      if (preRead && totalSize < maxTotalSize) {
        const isTextResource = !resource.mimeType || resource.mimeType.startsWith('text/');
        if (isTextResource) {
          const contents = await mcpManager.readResource(serverName, resource.uri);
          if (contents && contents.length > 0) {
            for (const item of contents) {
              if (item.text) {
                const truncated = item.text.length > maxResourceSize
                  ? item.text.slice(0, maxResourceSize) + '\n... (内容已截断)'
                  : item.text;
                lines.push('');
                lines.push('```');
                lines.push(truncated);
                lines.push('```');
                totalSize += truncated.length;
                if (totalSize >= maxTotalSize) break;
              }
            }
          }
        }
      }
    }

    lines.push('');
    sections.push(lines.join('\n'));
  }

  if (preRead && totalSize > 0) {
    logger.log(`[MCP] 资源上下文总计 ${totalSize} 字符`);
  }

  if (sections.length === 0) return '';

  if (preRead) {
    return `\n\n---\n## MCP 资源上下文（已预加载）\n以下内容来自 MCP 服务器提供的资源，已在上下文中:\n\n${sections.join('\n')}`;
  }

  // 仅列表模式 — 告诉模型用 read_mcp_resource 工具按需读取
  return `\n\n---\n## 可用 MCP 资源\n以下资源来自 MCP 服务器，需要时请使用 \`read_mcp_resource\` 工具按需读取内容:\n\n${sections.join('\n')}\n> 提示: 这些资源不会自动加载到上下文中。如果你认为某个资源对当前任务有帮助，请调用 read_mcp_resource 工具并传入 serverName 和 uri 参数来获取其内容。`;
}
