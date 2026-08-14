# 仓库指南

## 项目结构与模块组织

`src/main.js` 是 CLI 入口，负责解析任务、初始化 MCP、组装模型与工具并运行 Agent。可复用逻辑应放在入口以外：

- `src/agent/ReactAgent.js`：与框架无关的 ReAct 循环。
- `src/tools/`：本地 LangChain 工具；新增工具必须在 `src/tools/index.js` 注册。
- `src/mcp/client.js`：管理外部 MCP 服务与资源。
- `src/prompts/`：系统提示词构建；`src/utils/`：日志、Token 计数、文本提取与结果压缩。
- 根目录 `.env` 存放本地密钥，`mcp-servers.json` 配置 MCP 连接；`demo-resource-server.js` 是本地 MCP 示例。

## 构建、测试与开发命令

统一使用 pnpm；`package.json` 会拒绝 npm 和 Yarn。

```bash
pnpm install                         # 安装依赖
node src/main.js                     # 启动交互模式
node src/main.js "分析这个仓库"       # 直接执行一项任务
node src/main.js -f task.md          # 从文件读取任务
```

需要 Node.js 18+。当前没有构建步骤、代码检查工具或自动化测试；`pnpm test` 是会失败的占位命令。提交前请以范围明确的任务手动验证受影响的 CLI 流程。

## 代码风格与命名约定

使用 ESM（`import`/`export`）和四空格缩进，并遵循 `src/` 现有风格。模块与函数采用 camelCase（如 `resultCompactor.js`、`createModel`），类采用 PascalCase（如 `ReactAgent`），工具文件以 `Tool.js` 结尾。使用 Zod schema 定义工具输入，并返回易读的结果字符串。

工具必须捕获运行错误并将其返回给 Agent，不能抛出或 reject。工具内不要直接调用 `console.log`；面向用户的进度信息统一由 `src/utils/logger.js` 输出。新增工具时，评估是否需要在 `resultCompactor.js` 中增加压缩显示策略。

## 配置与安全

在未提交的 `.env` 中配置 `DEEPSEEK_API_KEY`；不得把 API 密钥、令牌或私有 MCP 请求头写入源码或文档。可用 `MODEL_NAME`、`BASE_URL`、`MCP_SERVERS_CONFIG` 等环境变量覆盖本地配置。若 `mcp-servers.json` 含凭据，应视为敏感文件。

## 提交与拉取请求规范

遵循现有 Conventional Commit 格式：`feat: ...`、`fix: ...`、`refactor: ...`；历史中已使用简短中文说明。每次提交只处理一个明确主题。拉取请求须说明行为变化、影响的模块或配置、手动验证命令，以及新增的环境变量或 MCP 要求；仅在有助于说明 CLI 可见行为时附终端输出或截图。
