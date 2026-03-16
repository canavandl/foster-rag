const CHUNK_SIZE = 512;
const CHUNK_OVERLAP = 50;

// Page markers injected by the PDF extractor: <<<PAGE:N>>>
const PAGE_MARKER_RE = /^<<<PAGE:(\d+)>>>$/;

export interface ChunkWithPage {
  content: string;
  pageStart: number;
}

// Approximate token count using word split (good enough for English text)
function approximateTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function chunkText(text: string): ChunkWithPage[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const words: string[] = [];
  const wordPages: number[] = [];
  let currentPage = 0; // 0 = no page info (HTML / plain text)

  for (const token of tokens) {
    const m = token.match(PAGE_MARKER_RE);
    if (m) {
      currentPage = parseInt(m[1], 10);
    } else {
      words.push(token);
      wordPages.push(currentPage);
    }
  }

  const chunks: ChunkWithPage[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    chunks.push({
      content: words.slice(start, end).join(' '),
      pageStart: wordPages[start] ?? 0,
    });
    if (end >= words.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

export { approximateTokens };
