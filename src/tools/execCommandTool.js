import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { config } from '../config.js'
import { logger } from '../utils/logger.js'

/**
 * 执行命令并捕获输出
 *
 * 为什么不用 `stdio: 'inherit'`：
 *   inherit 只把输出打给终端，工具返回值里没有它 —— 模型执行完 `ls`、`git status`、
 *   `pnpm test` 之后什么也看不到，只能靠猜。Agent 要能干活，就必须让它看见命令的输出。
 *   所以这里改用 pipe 捕获，再把内容同时转发给终端（见 logger.commandOutput），
 *   终端实时可见的体验不变，模型也终于能读到结果。
 */
export const execCommandTool = tool(
    async ({ command, directoryPath }) => {
        try {
            return await new Promise((resolve) => {
                // 整条命令原样交给 shell 执行：shell 是路径时 Node 用 `-c` 调用它，
                // 是 true 时用系统默认 shell。自行按空格切分会把带引号/空格的命令拆坏。
                const childProcess = spawn(command, {
                    cwd: directoryPath || process.cwd(),
                    env: process.env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                    shell: config.shell,
                });

                let stdout = '';
                let stderr = '';
                let truncated = false;
                const limit = config.exec.outputLimit;

                const collect = (current, chunk) => {
                    const text = chunk.toString();
                    logger.commandOutput(text); // 实时透传，终端照旧看得见

                    if (current.length >= limit) {
                        truncated = true;
                        return current;
                    }

                    const room = limit - current.length;
                    // 单个 chunk 就可能超过上限（管道会攒一大块再一次性投递），
                    // 所以必须真的切片，光判断「累积前是否已满」不够
                    if (text.length > room) {
                        truncated = true;
                        return current + text.slice(0, room);
                    }

                    return current + text;
                };

                childProcess.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
                childProcess.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });

                childProcess.on('error', (error) => {
                    resolve(formatResult({
                        command, directoryPath, code: null, stdout, stderr, truncated, error: error.message,
                    }));
                });

                childProcess.on('close', (code) => {
                    resolve(formatResult({
                        command, directoryPath, code, stdout, stderr, truncated, error: null,
                    }));
                });
            });
        } catch (e) {
            return `命令执行异常: ${e.message}`;
        }
    },
    {
        name: 'exec_command',
        description: '执行命令，支持指定工作目录，返回 stdout / stderr / 退出码',
        schema: z.object({
            command: z.string().describe('要执行的命令'),
            directoryPath: z.string().optional().describe('工作目录，省略时使用当前工作目录。注意：指定后不要在 command 中再写 cd')
        })
    }
)

/**
 * 把执行结果整理成模型可读的文本
 *
 * 首行格式刻意保持 `命令执行成功: xxx` / `命令执行失败: xxx, 退出码: N` 不变 ——
 * ReactAgent 的语义压缩（_summarizeToolResult）和终端摘要都按这个前缀做匹配。
 */
function formatResult({ command, directoryPath, code, stdout, stderr, truncated, error }) {
    const cwdInfo = directoryPath ? `\n(工作目录: ${directoryPath})` : '';
    const lines = [];

    if (error) {
        lines.push(`命令执行异常: ${command} — ${error}${cwdInfo}`);
    } else if (code === 0) {
        lines.push(`命令执行成功: ${command}${cwdInfo}`);
    } else {
        // 不 reject — 返回错误信息让模型处理
        lines.push(`命令执行失败: ${command}, 退出码: ${code}${cwdInfo}`);
    }

    if (stdout.trim()) {
        lines.push('--- stdout ---', stdout.replace(/\s+$/, ''));
    }
    if (stderr.trim()) {
        lines.push('--- stderr ---', stderr.replace(/\s+$/, ''));
    }
    if (!stdout.trim() && !stderr.trim()) {
        lines.push('(无输出)');
    }
    if (truncated) {
        lines.push(`(输出超过 ${config.exec.outputLimit} 字符，已截断)`);
    }

    return lines.join('\n');
}
