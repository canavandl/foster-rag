import type { Env, SourceCitation } from './types';

const SYSTEM_PROMPT = `You are an expert on Texas foster care regulations. Answer questions accurately and concisely based only on the provided regulatory context. If the context does not contain enough information to answer the question, say so clearly. Always cite the specific regulation sections you reference.`;

export async function generateAnswer(
  query: string,
  contextChunks: { content: string; metadata: SourceCitation }[],
  ai: Env['AI']
): Promise<string> {
  const context = contextChunks
    .map((c, i) => `[${i + 1}] ${c.metadata.title} (${c.metadata.section}):\n${c.content}`)
    .join('\n\n');

  const userPrompt = `Context from Texas foster care regulations:\n\n${context}\n\nQuestion: ${query}\n\nAnswer based on the context above, citing specific sections:`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (ai as any).run('@cf/meta/llama-3.1-8b-instruct-fast', {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1024,
  });

  const result = response as { response: string };
  return result.response;
}
