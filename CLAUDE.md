# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`min-cursor` 是一个极简的 AI 编码 Agent —— CLI 工具，使用 LLM 自主完成软件任务（创建项目、写代码、执行命令）。它实现了 ReAct（推理+行动）模式：模型决定调用哪个工具，工具执行后，结果反馈给模型进行下一步决策，直到任务完成或达到最大迭代次数。

工具系统支持 **MCP 协议**，可动态连接外部工具服务器，将 Agent 的能力从 4 个本地工具扩展到任意 MCP 生态工具。

## 技术栈

- **运行时**: Node.js（ESM — `"type": "module"`）
- **包管理器**: pnpm（≥11.10.0）
- **大模型**: DeepSeek V4 Flash，通过 `@langchain/openai` 调用（兼容 OpenAI 接口）
- **工具系统**: `@langchain/core/tools` + Zod v4 schema 校验 + MCP 动态工具
- **MCP 集成**: `@langchain/mcp-adapters` + `@modelcontextprotocol/sdk`

## 常用命令

```bash
pnpm install           # 安装依赖
node src/main.js       # 交互模式（回车使用 Demo 示例）
node src/main.js "用 pnpm 创建一个 Express 项目"   # 直接执行任务
node src/main.js -f task.md                      # 从文件读取任务
```

没有构建步骤、没有代码检查工具、没有测试套件。项目目前处于概念验证阶段。

## 项目架构

```
src/
├── main.js                      # 入口：解析 CLI → MCP 初始化 → 组装模型 → 运行
├── config.js                    # 模型/Agent/MCP 配置（环境变量可覆盖）
├── agent/
│   └── ReactAgent.js            # ReAct 循环核心类 — 可复用，与 CLI 解耦
├── mcp/
│   └── client.js                # MCP 客户端封装 — 连接多服务器，工具合并去重
├── prompts/
│   └── systemPrompt.js          # System prompt 模板（接受 cwd 参数）
├── tools/
│   ├── index.js                 # 本地工具注册中心 — 新增本地工具在这里注册
│   ├── readFileTool.js          # read_file：读取文件
│   ├── writeFileTool.js         # write_file：写入文件（自动创建父目录）
│   ├── listDirTool.js           # list_directory：列出目录
│   └── execCommandTool.js       # exec_command：执行 shell 命令
└── utils/
    └── logger.js                # 统一 chalk 日志工具
mcp-servers.json                 # MCP 服务器配置文件（项目根目录）
```

### 核心设计要点

**ReactAgent 类**（[src/agent/ReactAgent.js](src/agent/ReactAgent.js)）是项目的核心。它与 CLI 完全解耦——用 `{ model, tools, systemPrompt, maxIterations }` 构造，调用 `agent.run(task)` 即可执行。传入的 model 需要提前通过 `model.bindTools(tools)` 绑定好工具。

**错误不崩溃**：所有工具绝不 `reject()`，错误统一 catch 后以字符串形式作为 `ToolMessage` 内容返回给模型。这让模型能看到失败原因并尝试替代方案——这正是 ReAct 相比脚本化自动化的核心优势。

**可视化与执行分离**：工具文件是纯函数——只返回结果字符串，不做 console.log。所有终端输出统一通过 [src/utils/logger.js](src/utils/logger.js) 处理。新增工具时只需改工具实现和 [src/tools/index.js](src/tools/index.js) 注册，日志由 Agent 层统一管理。

**配置**（[src/config.js](src/config.js)）：所有配置都支持环境变量覆盖：`MODEL_NAME`、`DEEPSEEK_API_KEY`、`BASE_URL`、`TIMEOUT`、`MAX_ITERATIONS`。默认值指向 DeepSeek API。MCP 服务器配置从项目根目录的 `mcp-servers.json` 读取，也支持 `MCP_SERVERS_CONFIG` 环境变量指定自定义路径。

### MCP 工具系统（本地 + 动态）

启动时，[src/main.js](src/main.js) 通过 `McpClientManager`（[src/mcp/client.js](src/mcp/client.js)）连接 MCP 服务器，将 MCP 工具与本地工具合并后传给 Agent：

```
mcp-servers.json → config.mcp.servers → McpClientManager.init()
                                            ↓
                         MultiServerMCPClient.initializeConnections()
                                            ↓
本地工具 ──→ getTools(localTools) ←── MCP 动态工具
                  ↓
         本地优先去重（重名则保留本地版本）
                  ↓
           model.bindTools(tools)
```

**McpClientManager** 的关键行为：
- 连接失败不崩溃 —— 降级为仅本地工具
- 工具同名处理 —— 本地工具优先，MCP 重名工具被过滤
- 关闭时自动清理所有 MCP 连接（`main.js` 的 `finally` 块确保执行）

### 新增本地工具的方法

1. 创建 `src/tools/newTool.js` — 导出一个 `tool()` 实例，使用 Zod v4 schema 定义参数
2. 在 [src/tools/index.js](src/tools/index.js) 的 `tools` 数组中注册
3. （可选）在 `ReactAgent._summarizeResult()` 中为显示添加结果摘要逻辑

### 新增 MCP 工具的方法

1. 在 [mcp-servers.json](mcp-servers.json) 的 `mcpServers` 中添加服务器配置
2. 如果服务器需要安装（非 npx），先 `pnpm add <mcp-server-package>`，然后用 `node ./node_modules/<path>/dist/index.js` 作为 command
3. 重启 Agent 即可，无需改任何代码

MCP 服务器支持两种传输方式：
- **stdio**：`{ "command": "node", "args": [...], "env": {...} }` — 本地子进程通信
- **streamableHttp**：`{ "transport": "streamableHttp", "url": "http://..." }` — 远程 HTTP

### exec_command 的关键规则

当使用 `directoryPath` 参数时，**不要在 command 中写 `cd`**。`directoryPath` 已经切换了工作目录。

- ❌ 错误：`{ command: "cd subdir && pnpm install", directoryPath: "subdir" }`
- ✅ 正确：`{ command: "pnpm install", directoryPath: "subdir" }`

这条规则在 system prompt 中有强调，Agent 和工具设计也遵循此约定。
