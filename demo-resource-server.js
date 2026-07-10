/**
 * 演示 MCP 服务器 — 展示如何定义和暴露 Resources
 *
 * 启动方式:
 *   node demo-resource-server.js
 *
 * 这个文件演示了 MCP 资源的两种定义方式:
 *   1. 静态资源 — 固定 URI，内容不变
 *   2. 动态资源模板 — 参数化 URI，内容按需生成
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';

const server = new McpServer({
  name: 'demo-resource-server',
  version: '1.0.0',
});

// ========================================================================
// 工具（至少需要一个工具，否则某些客户端初始化会失败）
// ========================================================================
server.registerTool(
  'ping',
  {
    description: '健康检查 — 返回 pong',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: 'pong' }],
  })
);

// ========================================================================
// 方式1: 静态资源 — 固定的 URI，读取时返回固定内容
// ========================================================================
server.registerResource(
  '项目规范',                       // 资源名称（人类可读）
  'guide://coding-standards',      // 固定 URI
  {
    description: '团队编码规范和最佳实践',
    mimeType: 'text/markdown',
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: 'text/markdown',
      text: [
        '# 编码规范 v1.0',
        '',
        '## 命名约定',
        '- 文件名: kebab-case',
        '- 变量名: camelCase',
        '- 类名: PascalCase',
        '',
        '## 提交规范',
        '- feat: 新功能',
        '- fix: 修复',
        '- refactor: 重构',
        '',
        '## 目录结构',
        '```',
        'src/',
        '├── tools/     # 工具实现',
        '├── agent/     # Agent 核心',
        '└── prompts/   # 提示词模板',
        '```',
      ].join('\n'),
    }],
  })
);

// ========================================================================
// 方式2: 动态资源模板 — URI 包含参数，支持列出所有可能的资源
// ========================================================================
server.registerResource(
  '项目文件',
  // 注意: 避免使用 file:// scheme，SDK 会特殊处理导致路径异常
  new ResourceTemplate('project://files/{path}', {
    list: async () => ({
      resources: [
        { uri: 'project://files/package.json', name: 'package.json', description: '项目依赖和脚本' },
        { uri: 'project://files/CLAUDE.md',    name: 'CLAUDE.md',    description: '开发指南' },
        { uri: 'project://files/README.md',    name: 'README.md',    description: '项目说明' },
      ],
    }),
  }),
  {
    description: '读取项目文件内容',
    mimeType: 'text/plain',
  },
  async (uri, variables) => {
    const files = {
      'package.json': JSON.stringify({ name: 'min-cursor', version: '1.0.0', type: 'module' }, null, 2),
      'CLAUDE.md':    '# min-cursor — 极简 AI 编码 Agent (概念验证)\n\n基于 LangChain + DeepSeek 的 ReAct 模式。',
      'README.md':    '# min-cursor\n\n极简 AI 编码 Agent，使用 LLM 自主完成软件任务。',
    };

    const text = files[variables.path];
    if (!text) {
      throw new Error(`未知文件: ${variables.path}`);
    }

    return {
      contents: [{ uri: uri.href, mimeType: 'text/plain', text }],
    };
  }
);

// ========================================================================
// 启动服务器 (stdio 传输)
// ========================================================================
const transport = new StdioServerTransport();
await server.connect(transport);

// 输出到 stderr 以免干扰 stdio 通信
console.error('[demo-resource-server] 已启动，暴露 2 个资源 + ' +
  '1 个资源模板');
