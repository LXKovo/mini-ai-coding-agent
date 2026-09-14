import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { config } from '../config.js'

//执行命令工具(实时输出)
export const execCommandTool = tool(
    async ({ command, directoryPath }) => {
        try {
            return new Promise((resolve) => {
                // 整条命令原样交给 shell 执行：shell 是路径时 Node 用 `-c` 调用它，
                // 是 true 时用系统默认 shell。自行按空格切分会把带引号/空格的命令拆坏。
                const childProcess = spawn(command, {
                    cwd: directoryPath || process.cwd(),
                    env: process.env,
                    stdio: 'inherit',
                    shell: config.shell,
                });

                let errorMsg = '';
                childProcess.on('error', (error) => {
                    errorMsg = error.message;
                });

                childProcess.on('close', (code) => {
                    const cwdInfo = directoryPath
                        ? `\n(工作目录: ${directoryPath})`
                        : '';
                    if (code === 0) {
                        resolve(`命令执行成功: ${command}${cwdInfo}`);
                    } else {
                        // 不 reject — 返回错误信息让模型处理
                        resolve(`命令执行失败: ${command}, 退出码: ${code}, 错误: ${errorMsg || '未知错误'}${cwdInfo}`);
                    }
                });
            });
        } catch (e) {
            return `命令执行异常: ${e.message}`;
        }
    },
    {
        name: 'exec_command',
        description: '执行命令，支持指定工作目录，实时输出结果',
        schema: z.object({
            command: z.string().describe('要执行的命令'),
            directoryPath: z.string().optional().describe('工作目录，省略时使用当前工作目录。注意：指定后不要在 command 中再写 cd')
        })
    }
)