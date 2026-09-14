import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');

/**
 * 递归替换配置值中的 ${ENV_VAR} 占位符
 *
 * 让 mcp-servers.json 里的 token / key 不必明文落盘:
 *   "url": "https://mcp.amap.com/mcp?key=${AMAP_KEY}"
 *
 * 未定义的环境变量替换为空字符串，变量名收集到 missing 中统一告警。
 *
 * @param {*} value - 任意 JSON 值
 * @param {Set<string>} missing - 收集缺失的环境变量名
 * @returns {*} 替换后的值
 */
function resolveEnvPlaceholders(value, missing) {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => {
      if (process.env[name] === undefined) {
        missing.add(name);
        return '';
      }
      return process.env[name];
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvPlaceholders(item, missing));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, resolveEnvPlaceholders(val, missing)]),
    );
  }

  return value;
}

/**
 * 从 mcp-servers.json 读取 MCP 服务器配置
 * 也支持通过 MCP_SERVERS_CONFIG 环境变量指定自定义路径
 * 配置值中的 ${ENV_VAR} 占位符会在加载时替换为环境变量
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

    const missing = new Set();
    const servers = resolveEnvPlaceholders(parsed.mcpServers || {}, missing);

    if (missing.size > 0) {
      logger.warn(`MCP 配置引用了未定义的环境变量: ${[...missing].join(', ')} — 请在 .env 中配置，否则对应服务器会连接失败`);
    }

    return servers;
  } catch (e) {
    logger.warn(`MCP 配置文件读取失败: ${configPath} — ${e.message}`);
    return {};
  }
}

/**
 * exec_command 使用的 shell
 *
 * 优先 SHELL_PATH 环境变量；Windows 上探测常见的 Git Bash 安装位置，
 * 都找不到就回退 true（交给系统默认 shell），避免把某一台机器的路径写死。
 * @returns {string|true}
 */
function detectShell() {
  if (process.env.SHELL_PATH) {
    return process.env.SHELL_PATH;
  }

  if (process.platform !== 'win32') {
    return true;
  }

  const { ProgramFiles, LOCALAPPDATA } = process.env;
  const programFilesX86 = process.env['ProgramFiles(x86)'];

  const candidates = [
    ProgramFiles && `${ProgramFiles}\\Git\\bin\\bash.exe`,
    programFilesX86 && `${programFilesX86}\\Git\\bin\\bash.exe`,
    LOCALAPPDATA && `${LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
    'D:\\Git\\Git\\bin\\bash.exe', // 非标准安装位置（装在磁盘根目录下）的兜底候选
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || true;
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
    contextLimit: parseInt(process.env.CONTEXT_LIMIT) || 100_000,
  },
  /** exec_command 使用的 shell — 由 detectShell() 解析 */
  shell: detectShell(),
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
