# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

`min-cursor` 是一个极简的 AI 编码 Agent —— CLI 工具，使用 LLM 自主完成软件任务（创建项目、写代码、执行命令）。它实现了 ReAct（推理+行动）模式：模型决定调用哪个工具，工具执行后，结果反馈给模型进行下一步决策，直到任务完成或达到最大迭代次数。

## 技术栈

- **运行时**: Node.js（ESM — `"type": "module"`）
- **包管理器**: pnpm（≥11.10.0）
- **大模型**: DeepSeek V4 Flash，通过 `@langchain/openai` 调用（兼容 OpenAI 接口）
- **工具系统**: `@langchain/core/tools` + Zod v4 schema 校验

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
├── main.js                      # 入口：解析 CLI 参数 → 组装模型 + Agent → 运行
├── config.js                    # 模型和 Agent 配置（支持环境变量覆盖）
├── agent/
│   └── ReactAgent.js            # ReAct 循环核心类 — 可复用，与 CLI 解耦
├── prompts/
│   └── systemPrompt.js          # System prompt 模板（接受 cwd 参数）
├── tools/
│   ├── index.js                 # 工具注册中心 — 新增工具在这里注册
│   ├── readFileTool.js          # read_file：读取文件
│   ├── writeFileTool.js         # write_file：写入文件（自动创建父目录）
│   ├── listDirTool.js           # list_directory：列出目录
│   └── execCommandTool.js       # exec_command：执行 shell 命令
└── utils/
    └── logger.js                # 统一 chalk 日志工具
```

### 核心设计要点

**ReactAgent 类**（[src/agent/ReactAgent.js](src/agent/ReactAgent.js)）是项目的核心。它与 CLI 完全解耦——用 `{ model, tools, systemPrompt, maxIterations }` 构造，调用 `agent.run(task)` 即可执行。传入的 model 需要提前通过 `model.bindTools(tools)` 绑定好工具。

**错误不崩溃**：所有工具绝不 `reject()`，错误统一 catch 后以字符串形式作为 `ToolMessage` 内容返回给模型。这让模型能看到失败原因并尝试替代方案——这正是 ReAct 相比脚本化自动化的核心优势。

**可视化与执行分离**：工具文件是纯函数——只返回结果字符串，不做 console.log。所有终端输出统一通过 [src/utils/logger.js](src/utils/logger.js) 处理。新增工具时只需改工具实现和 [src/tools/index.js](src/tools/index.js) 注册，日志由 Agent 层统一管理。

**配置**（[src/config.js](src/config.js)）：所有配置都支持环境变量覆盖：`MODEL_NAME`、`DEEPSEEK_API_KEY`、`BASE_URL`、`TIMEOUT`、`MAX_ITERATIONS`。默认值指向 DeepSeek API。

### 新增工具的方法

1. 创建 `src/tools/newTool.js` — 导出一个 `tool()` 实例，使用 Zod v4 schema 定义参数
2. 在 [src/tools/index.js](src/tools/index.js) 的 `tools` 数组中注册
3. （可选）在 `ReactAgent._summarizeResult()` 中为显示添加结果摘要逻辑

### exec_command 的关键规则

当使用 `directoryPath` 参数时，**不要在 command 中写 `cd`**。`directoryPath` 已经切换了工作目录。

- ❌ 错误：`{ command: "cd subdir && pnpm install", directoryPath: "subdir" }`
- ✅ 正确：`{ command: "pnpm install", directoryPath: "subdir" }`

这条规则在 system prompt 中有强调，Agent 和工具设计也遵循此约定。
