import { Hono } from 'hono';
import type { Context } from 'hono';
import { generateEmbedding } from './embeddings';
import { chunkText } from './chunker';
import { upsertVectors, queryVectors } from './vectorize';
import { generateAnswer } from './rag';
import type { Env, QueryRequest, UploadRequest, SourceCitation, ChunkMetadata } from './types';
import HTML from '../public/index.html';

type AppContext = Context<{ Bindings: Env }>;

const app = new Hono<{ Bindings: Env }>();

// ── Auth middleware (upload only) ────────────────────────────────────────────

function requireAuth(c: AppContext): Response | null {
  if (!c.env.UPLOAD_API_KEY) {
    console.warn('UPLOAD_API_KEY not set - upload endpoint is unprotected!');
    return null;
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json(
      { error: 'Missing Authorization header' },
      401,
      { 'WWW-Authenticate': 'Bearer realm="foster-rag"' }
    ) as unknown as Response;
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (token !== c.env.UPLOAD_API_KEY) {
    return c.json({ error: 'Invalid API key' }, 403) as unknown as Response;
  }

  return null;
}

// ── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (c) => c.html(HTML));

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/query', async (c) => {
  const text = c.req.query('text');
  if (!text) {
    return c.json({ error: 'Missing required query parameter: text' }, 400);
  }

  const topK = Math.min(parseInt(c.req.query('topK') ?? '5', 10), 10);

  try {
    const embedding = await generateEmbedding(text, c.env.AI);
    const matches = await queryVectors(c.env.VECTORIZE, embedding, topK);

    if (!matches.matches.length) {
      return c.json({ answer: 'No relevant regulations found for your query.', sources: [] });
    }

    const chunkIds = matches.matches.map((m) => parseInt(m.id, 10));
    const placeholders = chunkIds.map(() => '?').join(', ');
    const stmt = c.env.DB.prepare(
      `SELECT c.id, c.content, c.metadata_json, d.title, d.source_url
       FROM chunks c JOIN documents d ON c.document_id = d.id
       WHERE c.id IN (${placeholders})`
    ).bind(...chunkIds);

    const rows = await stmt.all<{
      id: number;
      content: string;
      metadata_json: string;
      title: string;
      source_url: string;
    }>();

    const rowMap = new Map(rows.results.map((r) => [r.id, r]));

    const contextChunks = matches.matches
      .map((match) => {
        const row = rowMap.get(parseInt(match.id, 10));
        if (!row) return null;

        const meta = match.metadata as Record<string, string | number> | undefined;
        const citation: SourceCitation = {
          chunk_id: row.id,
          title: row.title,
          section: (meta?.section as string) ?? '',
          source_url: row.source_url ?? (meta?.source_url as string) ?? '',
          regulation_type: (meta?.regulation_type as string) ?? '',
          score: match.score,
          page_start: (meta?.page_start as number) ?? 0,
        };
        return { content: row.content, metadata: citation };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    const answer = await generateAnswer(text, contextChunks, c.env.AI);
    const sources = contextChunks.map((c) => c.metadata);

    return c.json({ answer, sources });
  } catch (err) {
    console.error('Query error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.post('/upload', async (c) => {
  const authError = requireAuth(c);
  if (authError) return authError;

  let body: UploadRequest;
  try {
    body = await c.req.json<UploadRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { title, regulation_type, source_url, effective_date, content, namespace, section, source_type } = body;

  if (!title || !regulation_type || !content || !namespace) {
    return c.json({ error: 'Missing required fields: title, regulation_type, content, namespace' }, 400);
  }

  try {
    const docResult = await c.env.DB.prepare(
      `INSERT INTO documents (title, regulation_type, source_url, effective_date) VALUES (?, ?, ?, ?)`
    )
      .bind(title, regulation_type, source_url ?? null, effective_date ?? null)
      .run();

    const documentId = docResult.meta.last_row_id as number;
    const chunks = chunkText(content);
    const embeddings = await Promise.all(chunks.map((chunk) => generateEmbedding(chunk.content, c.env.AI)));

    const vectors: { id: string; values: number[]; metadata: ChunkMetadata & { namespace: string } }[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const metadata: ChunkMetadata = {
        chunk_id: 0,
        regulation_type,
        effective_date: effective_date ?? '',
        section: section ?? '',
        source_url: source_url ?? '',
        source_type: source_type ?? 'regulation',
        page_start: chunks[i].pageStart,
      };

      const chunkResult = await c.env.DB.prepare(
        `INSERT INTO chunks (document_id, content, chunk_index, namespace, metadata_json) VALUES (?, ?, ?, ?, ?)`
      )
        .bind(documentId, chunks[i].content, i, namespace, JSON.stringify(metadata))
        .run();

      const chunkId = chunkResult.meta.last_row_id as number;
      metadata.chunk_id = chunkId;

      vectors.push({
        id: String(chunkId),
        values: embeddings[i],
        metadata: { ...metadata, namespace },
      });
    }

    await upsertVectors(c.env.VECTORIZE, vectors);

    return c.json({ success: true, document_id: documentId, chunks_created: chunks.length });
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
