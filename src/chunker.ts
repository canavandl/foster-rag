const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

// Approximate token count using word split (good enough for English text)
function approximateTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function chunkText(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const chunk = words.slice(start, end).join(' ');
    chunks.push(chunk);

    if (end >= words.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

export { approximateTokens };
