import { tool } from '@langchain/core/tools'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

//写文件工具
export const writeFileTool = tool(
    async ({ filePath, content }) => {
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, content, 'utf8');
            return `成功写入${filePath} (${Buffer.byteLength(content, 'utf8')} 字节)`;
        }
        catch (err) {
            return `写入文件 ${filePath} 失败: ${err.message}`;
        }
    },
    {
        name: 'write_file',
        description: `向指定路径写入文件内容，自动创建文件目录。`,
        schema: z.object({
            filePath: z.string().describe('要写入的文件路径'),
            content: z.string().describe('要写入文件的文本内容')
        })

    }
)