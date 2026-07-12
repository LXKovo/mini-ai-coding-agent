# 从零给 AI Agent 加上下文管理：别再让你的 Agent 偷偷烧 Token 了

> 我写了一个极简的 AI 编码 Agent，跑得很欢——直到有一天它读了三个大文件，然后 API 开始报错。我这才意识到，Agent 的上下文管理不是"高级功能"，是基础设施。

---

## 问题：一个越来越蠢的 Agent

几个月前我用 LangChain + DeepSeek 搭了一个 ReAct Agent。逻辑很简单：

```
用户输入任务 → LLM 决定调用哪个工具 → 工具执行 → 结果返回 LLM → 再决定下一步
```

跑 Demo 的时候一切正常，创建 React 项目、写几个文件、安装依赖——完美。

直到有一天我让它读三个源文件，分析一下代码结构然后写个重构方案。跑到第 8 轮的时候，API 开始报错：

```
Error: Request failed with status code 400
context length exceeded
```

我看了一下终端日志，每轮迭代的消息数组里**拖着前 7 轮读取的全部文件内容**。三个文件加起来 15000 字符的代码，每一轮都原封不动地重新发送给 DeepSeek。

15 轮迭代，每次 API 调用都把完整历史传过去——这不是 Agent，这是一台 Token 焚化炉。

---

## 根因：LLM 是无状态的

这件事听起来很基础，但自己动手写 Agent 之前我真的没意识到：

> **LLM 每一次 API 调用都是独立计算。它没有"记忆"，上下文全靠你把历史消息重新发过去。**

```js
// 你以为 Agent 在第 8 轮的状态：
"我已经读完了三个文件，现在来分析它们"

// 实际发生的事情：
model.invoke([
  SystemMessage,        // 规则
  HumanMessage,         // 用户任务
  AIMessage,            // "我要读文件A"
  ToolMessage,          // 文件A的 5000 字完整内容 ← 已经用完了！
  AIMessage,            // "我要读文件B"
  ToolMessage,          // 文件B的 4000 字完整内容 ← 已经用完了！
  AIMessage,            // "我要读文件C"
  ToolMessage,          // 文件C的 6000 字完整内容 ← 已经用完了！
  // ... 加上前 7 轮累积的 AIMessage 和 ToolMessage
])
```

模型看到的是一个扁平的消息列表。你的 Agent 代码在循环，但模型**不知道**什么是"之前"——它只是把整个列表塞进 Transformer 做一次前向计算。第 1 轮读的文件内容，第 8 轮还在传，因为它在消息列表里就是一条消息而已。

DeepSeek V4 Flash 的上下文窗口是 128K tokens。听起来很大，但一次 `read_file` 返回 5000 字符 ≈ 约 2000 tokens（中英文混合），10 轮迭代轻松突破 10 万。

---

## 解决思路：四层防护

我花了两个下午给 Agent 加了完整的上下文管理。核心思路很简单：

> **不是不传历史，而是传该传的、截该截的、兜底有保障。**

### 第一层：Token 计数 —— 先能量化，才能管理

所有管理的起点是**知道现在用了多少 token**。

我引入了 `tiktoken`，OpenAI 开源的本地分词库。它和 DeepSeek 的 tokenizer 误差在 5% 以内——做监控和阈值判断完全够用：

```js
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4'); // 模块顶层单例

export function countTokens(messages) {
  let total = 0;
  for (const msg of messages) {
    total += 4; // 每条消息的固定开销
    total += enc.encode(String(msg.content)).length;
    // 还要算上 tool_calls 的序列化开销
    if (msg.tool_calls) {
      total += enc.encode(JSON.stringify(msg.tool_calls)).length;
    }
  }
  return total;
}
```

然后在 Agent 的循环里，每一轮开始前计算并打印：

```js
for (let i = 0; i < this.maxIterations; i++) {
  const used = countTokens(messages);
  logger.log(`📊 上下文 token: ${used} / ${contextLimit}`);

  if (used > contextLimit * 0.8) {
    // 触发压缩...
  }

  const response = await this.model.invoke(messages);
  // ...
}
```

**光这一行日志就值回票价**。你现在能看到 token 数从第 1 轮的 800 涨到第 8 轮的 82000，每一轮的增长都清清楚楚。

---

### 第二层：工具结果截断 —— 别把整本字典塞进上下文

这是最直接也最有效的优化。

`read_file` 返回了 5000 行代码。模型当时确实看了——处理完后，下一轮它只需要知道"那个文件大概是做什么的"就够了。但第 2 轮到第 15 轮，这 5000 行代码全在上下文中原样保留。

**截断策略**：

```js
function truncateFile(content) {
  const MAX_HEAD = 200;  // 保留前 200 行（import/类定义）
  const MAX_TAIL = 20;   // 保留最后 20 行（export）

  const lines = content.split('\n');
  if (lines.length <= MAX_HEAD + MAX_TAIL + 10) return content;

  const head = lines.slice(0, MAX_HEAD).join('\n');
  const tail = lines.slice(-MAX_TAIL).join('\n');
  const skipped = lines.length - MAX_HEAD - MAX_TAIL;

  return [
    head,
    `... (省略中间 ${skipped} 行 / ${lines.length} 总行数) ...`,
    tail,
  ].join('\n');
}
```

**关键设计**：工具本身返回完整结果（纯函数，不做截断），截断只发生在构建 `ToolMessage` 时。这样终端日志里你看到的还是"读取了 5234 字符"的完整摘要，但发给模型的已经是被截断的版本。

对 `exec_command` 也是类似的策略——命令输出保留头部 20 行 + 尾部 80 行，中间省略。因为编译日志、安装输出的中间部分几乎都是重复信息，真正有用的"是成功还是失败"在最开头或最末尾。

---

### 第三层：语义压缩 —— 不是简单丢弃，是提取信息

当 token 使用量超过阈值的 80%，触发语义压缩。

**我做错的第一个版本**：把中间消息每条的**前 100 个字符**截取出来拼在一起作为摘要。结果模型看到的是：

```
[ToolMessage] import { tool } from '@langchain/core/tools'
import fs from 'node:fs/promises'
import path from '...
[ToolMessage] 命令执行成功: npm install react...
[ToolMessage] import React, { useState } f...
```

100 个字符能传递什么信息？几乎为零。

**改进后**：按消息类型提取真正有意义的信息：

```
🔧 调用: read_file({"filePath":"src/agent/ReactAgent.js"})
📄 read_file 结果: 289 行代码
🔧 调用: exec_command({"command":"pnpm install","directoryPath":"react-todo-app"})
✅ 执行: pnpm install
✍️ 写入 src/App.tsx (3456 字节)
💬 安装完成，接下来修改 App.tsx 实现 TodoList 功能
```

模型从这个摘要里能准确知道"之前读了什么文件、执行了什么命令、结果如何"——信息密度比盲截 100 字符高了不止一个数量级。

实现上用的是**规则匹配**而非 LLM 摘要。为什么不调 LLM？因为摘要调用本身也消耗 token——你为了省 token 而消耗 token，性价比存疑。而且对「工具调用历史」这种结构化信息，正则表达式就够了。

```js
// 核心思路：匹配工具返回格式，提取关键字段
function summarizeToolResult(content) {
  // write_file: "成功写入 src/App.tsx (3456 字节)"
  const writeMatch = content.match(/^成功写入 (.+?) \((\d+) 字节\)/);
  if (writeMatch) return `✍️ 写入 ${writeMatch[1]} (${writeMatch[2]} 字节)`;

  // exec_command: "命令执行成功: pnpm install"
  const execMatch = content.match(/^命令执行(成功|失败): (.+)/);
  if (execMatch) return `${execMatch[1] === '成功' ? '✅' : '❌'} 执行: ${execMatch[2]}`;

  // read_file: 文件内容含代码特征
  if (content.includes('import ') || content.includes('export ')) {
    return `📄 read_file 结果: ${content.split('\n').length} 行代码`;
  }
}
```

---

### 第四层：硬截断兜底

语义压缩后如果 token 还是超标——比如压缩完还有 96000 tokens，超过 95% 阈值——那就触发硬截断：

```js
function hardTruncate(messages) {
  return [
    messages[0],              // SystemMessage 不动
    HumanMessage("[硬截断 — 丢弃了中间 15 条消息]"),
    ...messages.slice(-4),    // 只保留最近 4 条
  ];
}
```

**这是一个工程决策**：宁可丢失上下文，也不能让 API 调用失败。Agent 丢了上下文可以靠"重新读文件"来恢复，但 API 报错就直接挂了。

---

## 其他顺手修的问题

在加上下文管理的过程中，顺手把项目结构也整理了：

- **`readFileTool` 加了文件大小保护**：超过 500KB 只读前 200 行，`fs.open` 流式读取不占内存。防止 Agent 意外读了个 JSON 日志文件直接 OOM
- **`execCommandTool` 的 bash 路径从硬编码移到 `config.js`**：Windows 上需要 Git Bash，路径现在通过环境变量可配
- **截断和摘要逻辑抽到 `utils/` 下**：`ReactAgent` 从 275 行瘦到 170 行，只做 ReAct 循环。工具结果处理全部由 `resultCompactor.js` 负责

---

## 写完后的反思

### 上下文管理不是"功能"，是基础设施

一个没有上下文管理的 Agent 就像没有连接池的数据库——单次请求没问题，稍微跑久一点就会挂。你在给它加的是**工程基础**，不是花活。

### 别忘了 Agent 还有哪些缺的

上下文管理只是四块拼图之一。整理了当前项目的状态：

| 模块 | 状态 | 关键缺失 |
|---|---|---|
| 工具调用 | ✅ 完成 | 本地 4 个 + MCP 动态 |
| 上下文管理 | ⚠️ 初步 | 四层防护就位，但规则匹配需要改成策略注册 |
| 任务规划 | ❌ 空白 | 纯 ReAct，无显式 Plan-and-Execute |
| 长期记忆 | ❌ 空白 | 无持久化存储，每次启动从零开始 |

任务规划和长期记忆是下一阶段的目标——上下文管理让你 Agent 能跑完一个长任务，记忆让它不需要每次重启都重新了解这个项目。

### 工具越多，硬编码越疼

当前 `compactToolResult` 里用 `if toolName === 'read_file'` 这种硬编码路由。4 个工具无所谓，40 个呢？正确的做法应该是每个工具声明自己的"我该怎么被截断、我该怎么被摘要"，注册到一个策略 Map 里，路由层只做通用分发。这个已经标记为待改进项，不急但得做。

---

## 写在最后

如果你也在自己撸 Agent，三个建议：

1. **Token 计数值10行代码**——加了就知道 Agent 实际在消耗多少 token，比任何分析工具都直观
2. **大结果截断比任何高级压缩都有效**——5 行代码截断 `read_file` 结果，省掉 80% 的冗余 token
3. **不要一开始就追求完美**——我的第一版摘要就是 100 字符盲截，跑起来再改。先让 Agent 活着，再让它聪明

代码在 [github.com/yourname/min-cursor](https://github.com)（你自己替换链接），欢迎讨论和拍砖。

---

*本文写于 2026 年 7 月，项目用的是 DeepSeek V4 Flash + LangChain + Node.js。上下文管理的思路和具体实现的关联不大，你用 Python/LangChain/GPT-4 一样适用。*
