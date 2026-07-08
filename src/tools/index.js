import { readFileTool } from './readFileTool.js';
import { writeFileTool } from './writeFileTool.js';
import { listDirTool } from './listDirTool.js';
import { execCommandTool } from './execCommandTool.js';

/**
 * 工具注册中心 — 所有可用工具的统一导出点
 * 添加新工具只需在这里注册即可
 */
export const tools = [
  readFileTool,
  writeFileTool,
  listDirTool,
  execCommandTool,
];
