import type { Env } from './types';

export async function generateEmbedding(text: string, ai: Env['AI']): Promise<number[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (ai as any).run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
    pooling: 'cls',
  });

  const result = response as { data: number[][] };
  return result.data[0];
}

export async function generateEmbeddings(texts: string[], ai: Env['AI']): Promise<number[][]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (ai as any).run('@cf/baai/bge-base-en-v1.5', {
    text: texts,
    pooling: 'cls',
  });

  const result = response as { data: number[][] };
  return result.data;
}
