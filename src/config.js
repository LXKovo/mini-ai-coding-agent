import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

/**
 * 从 mcp-servers.json 读取 MCP 服务器配置
 * 也支持通过 MCP_SERVERS_CONFIG 环境变量指定自定义路径
 */
function loadMcpServersConfig() {
  const configPath = process.env.MCP_SERVERS_CONFIG
    || resolve(ROOT_DIR, 'mcp-servers.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.mcpServers || {};
  } catch (e) {
    console.warn(`⚠️  MCP 配置文件读取失败: ${configPath} — ${e.message}`);
    return {};
  }
}

/**
 * 集中配置 — 模型参数、连接信息、MCP 服务器
 * 所有可变配置集中在此，方便切换模型或调整参数
 */
export const config = {
  model: {
    name: process.env.MODEL_NAME || 'deepseek-v4-flash',
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.BASE_URL || 'https://api.deepseek.com/v1',
    timeout: parseInt(process.env.TIMEOUT) || 60000,
  },
  agent: {
    maxIterations: parseInt(process.env.MAX_ITERATIONS) || 15,
  },
  mcp: {
    /** MCP 服务器配置 — 来自 mcp-servers.json */
    servers: loadMcpServersConfig(),
    /** 是否在工具名前添加服务器名称前缀，避免同名冲突 */
    prefixToolNameWithServerName: process.env.MCP_PREFIX_TOOLS !== 'false',
  },
};

/**
 * 创建并返回配置好的 ChatOpenAI 实例
 */
export function createModel() {
  return new ChatOpenAI({
    model: config.model.name,
    apiKey: config.model.apiKey,
    configuration: {
      baseURL: config.model.baseURL,
    },
    timeout: config.model.timeout,
  });
}
