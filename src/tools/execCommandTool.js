import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { spawn } from 'node:child_process'

//执行命令工具(实时输出)
export const execCommandTool = tool(
    async ({ command, directoryPath }) => {
        try {
            return new Promise((resolve) => {
                const [cmd, ...args] = command.split(' ');
                const childProcess = spawn(cmd, args, {
                    cwd: directoryPath || process.cwd(),
                    env: process.env,
                    stdio: 'inherit',
                    shell: process.platform === 'win32'
                        ? 'D:\\Git\\Git\\bin\\bash.exe'
                        : true,
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
            directoryPath: z.string().describe('工作目录')
        })
    }
)