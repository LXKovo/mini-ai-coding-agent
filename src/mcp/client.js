import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

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
  #client = null;
  #connected = false;

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
      logger.warn(`[MCP] 连接失败: ${e.message}`);
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
