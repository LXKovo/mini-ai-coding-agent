import { tool } from '@langchain/core/tools'
import fs from 'node:fs/promises'
import { z } from 'zod'

const MAX_SIZE = 500 * 1024; // 500KB — 超过此大小只读前 200 行

export const readFileTool = tool(
    async ({ filePath }) => {
        try {
            const stat = await fs.stat(filePath);

            if (stat.size > MAX_SIZE) {
                // 文件过大 → 只读前 200 行，防止撑爆上下文
                const head = await readHeadLines(filePath, 200);
                const kb = (stat.size / 1024).toFixed(0);
                return [
                    head,
                    '',
                    `[文件过大 (${kb}KB)，已截断 — 仅显示前 200 行]`,
                ].join('\n');
            }

            return await fs.readFile(filePath, 'utf8');
        } catch (err) {
            return `读取文件 ${filePath} 失败: ${err.message}`;
        }
    },
    {
        name: 'read_file',
        description: '读取文件内容。文件超过 500KB 时只返回前 200 行。',
        schema: z.object({
            filePath: z.string().describe('要读取的文件路径，支持相对路径和绝对路径'),
        }),
    }
);

/**
 * 高效读取文件前 N 行（流式读取，不加载整个文件到内存）
 */
async function readHeadLines(filePath, maxLines) {
    const fd = await fs.open(filePath, 'r');

    try {
        let buffer = '';
        const readBuf = Buffer.alloc(64 * 1024);
        let lines = 0;

        while (lines < maxLines) {
            const { bytesRead } = await fd.read(readBuf, 0, readBuf.length, null);
            if (bytesRead === 0) break;

            buffer += readBuf.toString('utf8', 0, bytesRead);
            lines = buffer.split('\n').length;
        }

        const allLines = buffer.split('\n');
        return allLines.slice(0, maxLines).join('\n');
    } finally {
        await fd.close();
    }
}
