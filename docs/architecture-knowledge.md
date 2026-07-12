# min-cursor 架构知识总结

> 基于 2026-07-12 对话的完整复盘

---

## 一、Agent 核心四大模块 & 本项目现状

| 模块 | 本质问题 | 本项目实现 |
|---|---|---|
| **任务规划** | 如何把复杂目标拆成可执行的子步骤 | ❌ 纯 ReAct，无显式规划层 |
| **上下文管理** | LLM 每次调用是无状态的，历史消息会撑爆窗口 | ⚠️ 初步完成（见第二章） |
| **长期/短期记忆** | 跨会话保持信息，避免每次从零开始 | ❌ 完全空白 |
| **工具调用** | Agent 与外部世界交互的接口 | ✅ 实现最完整（本地+MCP） |

---

## 二、上下文管理模块 — 详细实现

### 2.1 核心问题

LLM 是**无状态函数**：

```
f(systemPrompt + 消息历史 + 当前输入) → 输出
```

Agent 每轮迭代都要把**完整消息历史**重新发给 API。两个致命后果：

1. **Token 浪费**：3 轮前读的文件内容，每轮都在传，但模型早已不需要
2. **窗口溢出**：消息历史线性增长，超过上下文窗口（DeepSeek 128K）直接报错

### 2.2 四层防护体系

```
请求前 ──┬── ① Token 计数 (countTokens)          ← 感知
         ├── ② 工具结果截断 (compactToolResult)    ← 预防
         ├── ③ 语义压缩 (_compactMessages)        ← 止损 (80%)
         └── ④ 硬截断 (_hardTruncate)             ← 兜底 (95%)
```

#### ① Token 计数 — `src/utils/tokenCounter.js`

**底层原理**：BPE（Byte Pair Encoding）算法将文本切分为子词单元。`tiktoken` 是 OpenAI 用 Rust 实现的 BPE tokenizer 的 JS 绑定，在本地运行不联网。

**关键设计**：编码器在模块顶层单例初始化（`encoding_for_model('gpt-4')`），不在每次 `countTokens()` 调用时重复创建。

**精度考量**：DeepSeek 和 OpenAI 都是 BPE 分词，词汇表高度相似，用 GPT-4 词汇表估算 DeepSeek 的 token 数，误差在 5% 以内，做上下文预算判断完全够用。

**实际意义**：在发 API 请求**之前**知道当前消息有多少 token——没有这个度量，所有管理都是盲的。

#### ② 工具结果截断 — `src/utils/resultCompactor.js`

**策略**：
- `read_file`：保留前 200 行 + 后 20 行（头部有 import/类定义，尾部有 export）
- `exec_command`：保留前 20 行 + 后 80 行（尾部权重大，因为命令输出最关键的在最后）
- 通用：超过 5000 字符截取前 3000

**关键设计**：
- 工具本身返回完整结果（纯函数，不做截断）
- 截断只发生在 `ToolMessage` 构建时（ReactAgent 第 124 行）
- 终端日志仍显示完整摘要（`summarizeToolResult`），不影响开发者观察

**与结果摘要的区别**：

| | compactToolResult | summarizeToolResult |
|---|---|---|
| 对谁 | 模型 | 开发者（终端） |
| 内容 | 截断后的内容 | 一行文本 |
| 目的 | 省 token | 可读性 |

#### ③ 语义压缩 — `ReactAgent._compactMessages`

**触发条件**：`countTokens(messages) > contextLimit * 0.8`

**策略**：保留 SystemMessage + 最近 6 条，中间消息逐条提取语义摘要合并为一条 HumanMessage。

**语义提取逻辑**（`_summarizeMessage` → `_summarizeToolResult`）：

```
AIMessage(含 tool_calls) → "🔧 调用: read_file({"filePath":"..."})"
AIMessage(纯文本)         → "💬 模型回复的前 80 字符"
ToolMessage              → 正则匹配工具输出格式，提取关键信息
  read_file 结果          → "📄 read_file 结果: 190 行代码"
  write_file 结果         → "✍️ 写入 src/App.tsx (3456 字节)"
  exec_command 结果       → "✅ 执行: pnpm install"
HumanMessage             → "👤 用户输入的前 80 字符"
```

**为什么不是 LLM 做摘要**：LLM 摘要更聪明但更贵——摘要调用本身也消耗 token。规则提取零额外成本，且对「工具调用历史」这种结构化信息效果足够好。

#### ④ 硬截断 — `ReactAgent._hardTruncate`

**触发条件**：语义压缩后 `countTokens(messages)` 仍 > `contextLimit * 0.95`

**策略**：只保留 SystemMessage + 最近 4 条，其余全部丢弃。

这是最后兜底——宁可丢上下文，不能让 API 调用因 token 超限而失败。

### 2.3 其他防护

- **readFileTool 文件大小保护**：超过 500KB 流式读取前 200 行，`fs.open` + 64KB 分块，不会把大文件全量加载到内存
- **config 可配**：`contextLimit` 通过 `CONTEXT_LIMIT` 环境变量覆盖，方便测试压缩逻辑

### 2.4 实际意义

| 没有上下文管理 | 有了之后 |
|---|---|
| 长任务跑到第 10+ 轮可能 API 报错 | 自动压缩，不会因 token 超限中断 |
| 不知道每次请求传了多少 token | 每轮都有 `📊 上下文 token: 5823 / 100000` |
| 读了大文件后每轮都全量带上 | 截断后只保留头尾结构 |
| 压缩后信息完全丢失 | 语义摘要保留「读了什么、执行了什么、结果如何」 |

### 2.5 在再生产级项目中的地位

上下文管理是 Agent 框架的**基础设施**，不是功能特性。类比：

```
Web 框架:  路由 → 中间件 → 控制器
数据库:    连接池 → 查询优化 → 事务
Agent:     工具调用 → 上下文管理 → 记忆
                ↑ 你在这层
```

LangChain、LangGraph、OpenAI Agents SDK 都有自己的上下文管理，但都是框架内置的。你自己从零搭建 Agent 就必须自己处理——这就是你现在在做的事。

---

## 三、项目已有能力

| 能力 | 实现位置 | 成熟度 |
|---|---|---|
| ReAct 循环 | `src/agent/ReactAgent.js` (289 行) | ✅ 稳定 |
| 本地工具 (4个) | `src/tools/` | ✅ 稳定 |
| MCP 动态工具 | `src/mcp/client.js` | ✅ 稳定 |
| MCP 资源按需读取 | `src/mcp/client.js` + `src/tools/readMcpResourceTool.js` | ✅ 稳定 |
| 上下文管理四层防护 | `src/utils/tokenCounter.js` + `resultCompactor.js` + `ReactAgent` | ⚠️ 初步完成 |
| 终端日志系统 | `src/utils/logger.js` | ✅ 稳定 |
| 集中配置 | `src/config.js` | ✅ 稳定 |

---

## 四、明确缺失的模块

### 4.1 任务规划

**问题**：当前是纯 ReAct，模型每轮根据当前状态即时决策。复杂任务（"搭建一个微服务项目"）缺少结构化分解。

**生产级方案**：
- Plan-and-Execute：先让模型输出完整计划 → 逐步执行 → 执行结果反馈调整
- 分层规划：高层目标 → 子任务 → 具体工具调用
- 需要计划状态追踪（哪些步骤完成/失败/跳过）

### 4.2 长期/短期记忆

**短期记忆（会话内）**：
- 当前 `messages` 数组只在 `run()` 方法内存在，函数返回即销毁
- 没有多轮对话能力——每次 `run()` 都是全新会话
- LangChain 的 Memory 模块存在但完全未使用

**长期记忆（跨会话）**：
- 无持久化存储（文件/SQLite/向量数据库）
- 每次启动 Agent 从零开始，不知道之前做过什么
- 无法积累项目知识（"这个项目的入口是 main.js"、"上次构建失败因为缺了 xxx 依赖"）

### 4.3 工具结果处理的策略注册机制

**问题**（已记录在 CLAUDE.md 待改进项）：
- `compactToolResult` 和 `summarizeToolResult` 都在用 `if toolName === 'xxx'` 硬编码匹配
- 每加一个本地工具需要改多处
- MCP 工具只能走通用兜底

**改进方向**：每个工具声明自己的 `compact`/`summarize` 处理器注册到 Map，路由层做 `registry.get(name) ?? fallback`。

---

## 五、当前文件结构

```
src/
├── config.js                         ← 所有可配置项（模型/Agent/MCP/shell）
├── main.js                           ← CLI 入口，组装各模块
├── agent/
│   └── ReactAgent.js                 ← ReAct 循环 + 上下文管理（289 行）
├── tools/
│   ├── index.js                      ← 工具注册中心
│   ├── readFileTool.js               ← 读文件（含大小保护）
│   ├── writeFileTool.js              ← 写文件（自动创建目录）
│   ├── listDirTool.js                ← 列目录
│   ├── execCommandTool.js            ← 执行命令（shell 从 config 读取）
│   └── readMcpResourceTool.js        ← MCP 资源按需读取
├── prompts/
│   └── systemPrompt.js               ← System prompt 模板
├── mcp/
│   └── client.js                     ← MCP 客户端封装（多服务器/资源管理）
└── utils/
    ├── logger.js                     ← 终端输出（chalk 封装）
    ├── tokenCounter.js               ← Token 计数（tiktoken）
    └── resultCompactor.js            ← 工具结果处理（截断 + 摘要）
```

---

## 六、关键设计原则（本次对话确立）

1. **工具是纯函数**：只返回结果字符串，不做日志、不做截断。截断和日志由 Agent 层统一处理
2. **utils 不依赖业务**：`tokenCounter`、`resultCompactor`、`logger` 都是无状态的纯函数模块
3. **配置集中管理**：所有可变参数在 `config.js`，环境变量可覆盖
4. **防御式上下文管理**：分层防护（截断→计数→软压缩→硬截断），每层独立生效
5. **本地工具先于 MCP 工具**：同名冲突时本地优先
