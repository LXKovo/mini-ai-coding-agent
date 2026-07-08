import { tool } from '@langchain/core/tools'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

//读文件工具
export const readFileTool = tool(
    async ({ filePath }) => {
        try {
            const content = await fs.readFile(filePath, 'utf8');
            return content;
        } catch (err) {
            return `读取文件 ${filePath} 失败: ${err.message}`;
        }
    },
    {
        name: 'read_file',
        description: `此工具是用来读取文件内容，当用户要求读取文件、查看代码、分析文件内容时，调用此工具。
输入文件路径（可以是相对路径或绝对路径）`,
        schema: z.object({
            filePath: z.string().describe('要读取的文件路径')
        })

    }
)