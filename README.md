# min-cursor

> 极简 AI 编码 Agent —— 基于 ReAct 模式的 CLI 工具，让 LLM 自主完成软件任务。

`min-cursor` 是一个命令行 AI 编程助手。你只需用自然语言描述任务，它就会自动规划、编写代码、执行命令、读取文件，并在遇到错误时自行修复——全程无需人工干预。它实现了 **ReAct（Reasoning + Acting）** 模式：模型决定调用哪个工具 → 工具执行 → 结果反馈给模型 → 模型决定下一步，直到任务完成。

工具系统原生支持 **[MCP 协议](https://modelcontextprotocol.io/)**（Model Context Protocol），可动态连接外部工具服务器，将 Agent 的能力从 4 个本地工具无缝扩展到任意 MCP 生态工具（文件系统增强、Chrome DevTools、GitHub/Gitee API、高德地图等）。

---

## 特性

- 🧠 **ReAct 自主循环** — 模型自主决策工具调用，自动处理错误并尝试替代方案
- 🔧 **MCP 协议集成** — 动态连接外部工具服务器，工具能力可无限扩展
- 📦 **MCP 资源按需读取** — 资源列表注入上下文但不占空间，模型按需调用 `read_mcp_resource` 获取内容
- 🛡️ **四级上下文防护** — 80% 软压缩 → 95% 硬截断，防止 token 超限导致 API 调用失败
- 🎯 **错误不崩溃** — 所有工具异常以消息形式返回给模型，模型可自行分析并重试
- 🖥️ **跨平台** — Windows / macOS / Linux，Windows 下自动配置 Git Bash 路径
- 🔌 **零配置扩展** — 新增 MCP 工具只需编辑 `mcp-servers.json`，无需改任何代码

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **pnpm** ≥ 8.0.0（推荐 ≥ 11.10.0）

### 安装

```bash
git clone <your-repo-url> min-cursor
cd min-cursor
pnpm install
```

### 配置

在项目根目录创建 `.env` 文件：

```bash
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

> 默认使用 DeepSeek V4 Flash 模型。你也可以通过 `BASE_URL` 和 `MODEL_NAME` 环境变量切换到其他兼容 OpenAI 接口的模型。

### 运行

```bash
# 交互模式（回车使用 Demo 示例——创建一个 React TodoList 应用）
node src/main.js

# 直接执行任务
node src/main.js "用 pnpm 创建一个 Express 项目"

# 从文件读取任务
node src/main.js -f task.md
```

## 使用示例

### 创建项目

```bash
node src/main.js "创建一个基于 Vite + React + TypeScript 的 Todo 应用，支持增删改查和本地持久化"
```

Agent 会自动：创建项目 → 编写代码 → 安装依赖 → 启动开发服务器。

### 代码修改

```bash
node src/main.js "在 src/utils 下添加一个 debounce 工具函数，并在 SearchBar 组件中使用它"
```

### 项目分析

```bash
node src/main.js "分析当前项目的目录结构，找出所有未使用的依赖"
```

## 项目架构

```
min-cursor/
├── src/
│   ├── main.js                      # 入口：CLI 解析 → MCP 初始化 → 模型组装 → 运行 Agent
│   ├── config.js                    # 集中配置（模型/Agent/MCP/Shell），全部支持环境变量覆盖
│   ├── agent/
│   │   └── ReactAgent.js            # ReAct 循环核心 — 与 CLI 完全解耦，可独立复用
│   ├── mcp/
│   │   └── client.js                # MCP 客户端 — 多服务器连接、工具合并去重、资源管理
│   ├── prompts/
│   │   └── systemPrompt.js          # System prompt 模板（参数化 cwd + 工具列表 + MCP 资源）
│   ├── tools/
│   │   ├── index.js                 # 本地工具注册中心
│   │   ├── readFileTool.js          # read_file：读取文件内容
│   │   ├── writeFileTool.js         # write_file：写入文件（自动创建父目录）
│   │   ├── listDirTool.js           # list_directory：列出目录结构
│   │   ├── execCommandTool.js       # exec_command：执行 shell 命令
│   │   └── readMcpResourceTool.js   # read_mcp_resource：按需读取 MCP 资源
│   └── utils/
│       ├── logger.js                # 统一 chalk 日志输出
│       ├── resultCompactor.js       # 工具结果截断 + 摘要（节省 token + 终端可读）
│       └── tokenCounter.js          # tiktoken 上下文 token 计数
├── mcp-servers.json                 # MCP 服务器配置文件
├── .env                             # API Key 等环境变量（不入 git）
├── CLAUDE.md                        # Claude Code 专用项目指南
└── package.json
```

## 内置工具

| 工具名 | 功能 | 说明 |
|--------|------|------|
| `read_file` | 读取文件 | 支持指定行范围，大文件自动截断（前 200 行 + 后 20 行） |
| `write_file` | 写入文件 | 自动创建父目录，覆盖写入 |
| `list_directory` | 列出目录 | 递归展示目录结构，支持深度控制 |
| `exec_command` | 执行命令 | 支持 `directoryPath` 切换工作目录，超时控制 |
| `read_mcp_resource` | 读取 MCP 资源 | 按需获取 MCP 服务器提供的文档/规范等参考内容 |

## MCP 工具扩展

### 已预配置的服务器

编辑 [mcp-servers.json](mcp-servers.json) 即可启用/禁用：

| 服务器 | 传输方式 | 功能 |
|--------|----------|------|
| **filesystem** | stdio | 搜索文件、目录树、编辑/移动文件、批量读取等 14 个工具 |
| **chrome-devtools** | stdio | 浏览器自动化、性能分析、DOM 检查、网络监控 |
| **gitee** | HTTP | Gitee 仓库管理、Issue、PR 等 200+ API |
| **amap** (高德地图) | HTTP | 地理编码、路径规划、POI 搜索、天气查询 |

### 添加新的 MCP 服务器

1. 在 `mcp-servers.json` 的 `mcpServers` 中添加配置：

```json
{
  "mcpServers": {
    "my-server": {
      "transport": "stdio",
      "command": "node",
      "args": ["./node_modules/my-mcp-server/dist/index.js"]
    }
  }
}
```

2. 如果服务器需要安装（非 npx），先执行 `pnpm add <package-name>`
3. 重启 Agent，新工具自动可用

支持两种传输方式：
- **stdio** — 本地子进程通信（`command` + `args`）
- **HTTP** — 远程 HTTP 连接（`transport: "http"` + `url` + `headers`）

### 工具同名策略

本地工具优先 —— 如果 MCP 工具与本地工具重名，保留本地版本，MCP 版本被过滤。这确保了核心工具的行为始终可控。

## 配置参考

所有配置均支持环境变量覆盖（详见 [src/config.js](src/config.js)）：

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `DEEPSEEK_API_KEY` | — | **必填**，API 密钥 |
| `MODEL_NAME` | `deepseek-v4-flash` | 模型名称 |
| `BASE_URL` | `https://api.deepseek.com/v1` | API 端点 |
| `MAX_ITERATIONS` | `15` | 最大 ReAct 迭代轮数 |
| `TIMEOUT` | `60000` | API 调用超时（毫秒） |
| `CONTEXT_LIMIT` | `100000` | 上下文 token 上限 |
| `SHELL_PATH` | Windows: `D:\Git\Git\bin\bash.exe` | 执行命令使用的 shell |
| `MCP_PREFIX_TOOLS` | `true` | 设为 `false` 禁用 MCP 工具名前缀 |
| `MCP_SERVERS_CONFIG` | `mcp-servers.json` | 自定义 MCP 配置文件路径 |

## 核心设计原则

### 错误不崩溃

所有工具**绝不 `reject()`** —— 错误统一 catch 后以字符串形式返回给模型。这让模型能看到失败原因并尝试替代方案，这是 ReAct 模式相比脚本化自动化的核心优势。

### 可视化与执行分离

工具文件是**纯函数** —— 只返回结果字符串，不做 `console.log`。所有终端输出统一通过 [logger.js](src/utils/logger.js) 处理。新增工具时只需关注工具逻辑本身，日志由 Agent 层统一管理。

### 上下文四层防护

为防止 token 超限导致 API 调用失败，Agent 内置了递进式防护：

1. **正常使用** — 消息历史完整保留
2. **80% 阈值** — 触发语义压缩：保留 system prompt + 最近 6 条 + 中间消息提取摘要
3. **95% 阈值** — 硬截断兜底：仅保留 system prompt + 最近 4 条
4. **结果截断** — 大文件/长输出自动截断，节省每次工具调用的 token 消耗

### ReactAgent 独立性

`ReactAgent` 类与 CLI 完全解耦 —— 用 `{ model, tools, systemPrompt, maxIterations }` 构造，调用 `agent.run(task)` 即可。你可以将它嵌入到任何 Node.js 应用中，不限于命令行。

## 新增本地工具

1. 创建 `src/tools/newTool.js`，导出一个使用 Zod v4 schema 的 `tool()` 实例
2. 在 [src/tools/index.js](src/tools/index.js) 的 `tools` 数组中注册
3. （可选）在 [src/utils/resultCompactor.js](src/utils/resultCompactor.js) 中添加对应的截断/摘要策略

```js
// src/tools/newTool.js 示例
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const myTool = tool(
  async ({ param1 }) => {
    // 工具逻辑 —— 返回字符串，不抛异常
    return `处理结果: ${param1}`;
  },
  {
    name: 'my_tool',
    description: '工具的用途说明',
    schema: z.object({
      param1: z.string().describe('参数说明'),
    }),
  }
);
```

## 技术栈

- **运行时**: Node.js（ESM）
- **LLM**: DeepSeek V4 Flash（通过 `@langchain/openai` 兼容接口调用）
- **Agent 框架**: LangChain (`@langchain/core` + `@langchain/mcp-adapters`)
- **MCP 协议**: `@modelcontextprotocol/sdk`
- **参数校验**: Zod v4
- **Token 计数**: tiktoken

## License

ISC
