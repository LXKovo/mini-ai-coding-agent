import { tool } from '@langchain/core/tools'
import fs from 'node:fs/promises'
import { z } from 'zod'

export const listDirTool = tool(
    async ({ directoryPath }) => {
        try {
            const files = await fs.readdir(directoryPath);
            return `目录内容 (${files.length} 项):\n${files.map(file => `- \`${file}\``).join('\n')}`
        } catch (e) {
            return `读取目录 ${directoryPath} 失败: ${e.message}`
        }
    },
    {
        name: 'list_directory',
        description: '列出指定目录下的所有文件和文件夹',
        schema: z.object({
            directoryPath: z.string().describe('要列出的目录路径')

        })
    }
)