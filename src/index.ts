import { generateEmbedding } from './embeddings';
import { chunkText } from './chunker';
import { upsertVectors, queryVectors } from './vectorize';
import { generateAnswer } from './rag';
import type { Env, QueryRequest, UploadRequest, SourceCitation, ChunkMetadata } from './types';
import HTML from '../public/index.html';

function requireAuth(request: Request, env: Env): Response | null {
  // Skip auth if UPLOAD_API_KEY not configured (dev mode)
  if (!env.UPLOAD_API_KEY) {
    console.warn('UPLOAD_API_KEY not set - upload endpoint is unprotected!');
    return null;
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return Response.json(
      { error: 'Missing Authorization header' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="foster-rag"' },
      }
    );
  }

  // Support both "Bearer token" and just "token"
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (token !== env.UPLOAD_API_KEY) {
    return Response.json({ error: 'Invalid API key' }, { status: 403 });
  }

  return null; // Auth successful
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '') {
      return new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' });
    }

    if (url.pathname === '/query') {
      return handleQuery(request, env, url);
    }

    if (url.pathname === '/upload' && request.method === 'POST') {
      const authError = requireAuth(request, env);
      if (authError) return authError;

      return handleUpload(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleQuery(request: Request, env: Env, url: URL): Promise<Response> {
  const text = url.searchParams.get('text');
  if (!text) {
    return Response.json({ error: 'Missing required query parameter: text' }, { status: 400 });
  }

  const namespace = url.searchParams.get('namespace') as QueryRequest['namespace'] | null;
  const topK = Math.min(parseInt(url.searchParams.get('topK') ?? '5', 10), 10);

  try {
    // 1. Generate embedding for the query
    const embedding = await generateEmbedding(text, env.AI);

    // 2. Query Vectorize
    const matches = await queryVectors(env.VECTORIZE, embedding, topK, namespace ?? undefined);

    if (!matches.matches.length) {
      return Response.json({ answer: 'No relevant regulations found for your query.', sources: [] });
    }

    // 3. Retrieve full chunk content from D1
    const chunkIds = matches.matches.map((m) => parseInt(m.id, 10));
    const placeholders = chunkIds.map(() => '?').join(', ');
    const stmt = env.DB.prepare(
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

    // Map rows by chunk id for ordered lookup
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

    // 4. Generate answer using LLM
    const answer = await generateAnswer(text, contextChunks, env.AI);

    const sources = contextChunks.map((c) => c.metadata);

    return Response.json({ answer, sources });
  } catch (err) {
    console.error('Query error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  let body: UploadRequest;
  try {
    body = await request.json<UploadRequest>();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { title, regulation_type, source_url, effective_date, content, namespace, section, source_type } = body;

  if (!title || !regulation_type || !content || !namespace) {
    return Response.json(
      { error: 'Missing required fields: title, regulation_type, content, namespace' },
      { status: 400 }
    );
  }

  try {
    // 1. Insert document record
    const docResult = await env.DB.prepare(
      `INSERT INTO documents (title, regulation_type, source_url, effective_date) VALUES (?, ?, ?, ?)`
    )
      .bind(title, regulation_type, source_url ?? null, effective_date ?? null)
      .run();

    const documentId = docResult.meta.last_row_id as number;

    // 2. Chunk the content (parses <<<PAGE:N>>> markers if present)
    const chunks = chunkText(content);

    // 3. Generate embeddings (batch)
    const embeddings = await Promise.all(chunks.map((c) => generateEmbedding(c.content, env.AI)));

    // 4. Insert chunks into D1 and upsert vectors
    const vectors: { id: string; values: number[]; metadata: ChunkMetadata & { namespace: string } }[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const metadata: ChunkMetadata = {
        chunk_id: 0, // will be set after insert
        regulation_type,
        effective_date: effective_date ?? '',
        section: section ?? '',
        source_url: source_url ?? '',
        source_type: source_type ?? 'regulation',
        page_start: chunks[i].pageStart,
      };

      const chunkResult = await env.DB.prepare(
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

    // 5. Upsert all vectors
    await upsertVectors(env.VECTORIZE, vectors);

    return Response.json({
      success: true,
      document_id: documentId,
      chunks_created: chunks.length,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
