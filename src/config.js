import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';

/**
 * 集中配置 — 模型参数、连接信息
 * 所有可变配置集中在此，方便切换模型或调整参数
 */
export const config = {
  model: {
    name: process.env.MODEL_NAME || 'deepseek-v4-flash',
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: process.env.BASE_URL || 'https://api.deepseek.com/v1',
    timeout: parseInt(process.env.TIMEOUT) || 60000,
  },
  agent: {
    maxIterations: parseInt(process.env.MAX_ITERATIONS) || 15,
  },
};

/**
 * 创建并返回配置好的 ChatOpenAI 实例
 */
export function createModel() {
  return new ChatOpenAI({
    model: config.model.name,
    apiKey: config.model.apiKey,
    configuration: {
      baseURL: config.model.baseURL,
    },
    timeout: config.model.timeout,
  });
}
