# RAG System for Texas Foster Care Regulations using Cloudflare Vectorize

## Context
Building a RAG (Retrieval Augmented Generation) system as a learning exercise to query Texas foster care regulations. This system will allow users to ask natural language questions about foster care regulations and receive contextually accurate answers backed by the actual regulatory text.

## Architecture Overview

**Stack**: D1 + Vectorize (768 dims, cosine) + bge-base-en-v1.5 + llama-3.1-8b-instruct-fast

### Key Decisions (from swarm debate)
- **D1 over R2**: Correct for access patterns (topK=5 means small, frequent reads)
- **Metadata filtering** within a single index (Cloudflare best practice over namespaces)
- **Fixed-size chunking** (512 tokens, 50 overlap) — start simple, iterate based on data
- **Manual processing** in Phase 1 — no premature automation
- **topK=5** — increase to 10 only if recall data shows need

---

## Phase 1: Core RAG System

### 1. Project Setup

**File**: `wrangler.jsonc`
```json
{
  "name": "foster-care-rag",
  "main": "src/index.ts",
  "compatibility_date": "2026-03-14",
  "vectorize": [{
    "binding": "VECTORIZE",
    "index_name": "foster-care-regulations"
  }],
  "d1_databases": [{
    "binding": "DB",
    "database_name": "foster-care-db",
    "database_id": "<generated>"
  }],
  "ai": {
    "binding": "AI"
  }
}
```

**Setup commands**:
```bash
npm create cloudflare@latest -- foster_rag --type=simple --ts --no-deploy
wrangler vectorize create foster-care-regulations --dimensions=768 --metric=cosine
wrangler d1 create foster-care-db
```

### 2. Database Schema

**File**: `schema.sql`
```sql
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  regulation_type TEXT NOT NULL,
  source_url TEXT,
  effective_date TEXT,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  namespace TEXT NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id)
);

CREATE INDEX idx_chunks_namespace ON chunks(namespace);
CREATE INDEX idx_chunks_document ON chunks(document_id);
```

**Apply**: `wrangler d1 execute foster-care-db --file=schema.sql`

### 3. File Structure

```
foster_rag/
├── wrangler.jsonc          # Cloudflare configuration
├── schema.sql              # D1 database schema
├── src/
│   ├── index.ts           # Main Worker (endpoints: /query, /upload, /health)
│   ├── embeddings.ts      # bge-base-en-v1.5 with pooling: 'cls'
│   ├── chunker.ts         # 512-token fixed-size with 50-token overlap
│   ├── vectorize.ts       # upsertVectors, queryVectors
│   ├── rag.ts             # generateAnswer with llama-3.1-8b-instruct-fast
│   └── types.ts           # TypeScript interfaces
├── scripts/
│   ├── upload-document.ts # Manual document ingestion
│   └── evaluate.ts        # Precision/recall metrics
└── test/
    └── queries.test.ts    # Integration tests
```

### 4. Namespaces (pre-search filtering)

| Namespace | Purpose |
|-----------|---------|
| `caseworker` | Regulations for case workers |
| `foster_parent` | Regulations for foster parents |
| `admin` | Administrative regulations |
| `general` | General / cross-cutting regulations |
| `legal` | Legal compliance and statutory requirements |

### 5. Metadata Schema

```typescript
interface ChunkMetadata {
  chunk_id: number;
  regulation_type: string;
  effective_date: string;
  section: string;
  source_url: string;
  source_type: 'regulation' | 'policy' | 'guide';
}
```

### 6. RAG Query Flow

1. User submits query with optional namespace filter
2. Generate embedding using `bge-base-en-v1.5` (`pooling: 'cls'`)
3. Query Vectorize (namespace-filtered, topK=5, returnMetadata='all')
4. Retrieve full chunks from D1 using chunk IDs
5. Construct prompt with context + query
6. Generate response using `llama-3.1-8b-instruct-fast`
7. Return answer with source citations (regulation names, sections, URLs)

### 7. Workers AI Models

| Model | Dimensions | Cost | Use |
|-------|-----------|------|-----|
| `@cf/baai/bge-small-en-v1.5` | 384 | $0.02/M tokens | — |
| `@cf/baai/bge-base-en-v1.5` | **768** | $0.067/M tokens | **Embeddings (chosen)** |
| `@cf/baai/bge-large-en-v1.5` | 1024 | $0.20/M tokens | — |
| `@cf/meta/llama-3.1-8b-instruct-fast` | — | — | **LLM (chosen)** |

---

## Phase 2: Quality & Iteration

### Evaluation (`scripts/evaluate.ts`)
- Test queries with known answers
- Measure precision@5, recall@10
- Track namespace filtering effectiveness

### Potential enhancements (only if data shows need)
- Add `@cf/baai/bge-reranker-base` if precision < 0.8
- Hybrid search (vector + keyword)
- Adjust chunk size/overlap
- Static frontend (Cloudflare Pages) with a simple query UI

---

## Phase 3: Advanced Features (Future)

- Case law integration (pending data source validation)
- Automated update checking via Cloudflare Workflows
- Citation graph visualization
- Compliance change notifications

---

## Verification Checklist

- [ ] Vectorize index created with 768 dimensions (`wrangler vectorize list`)
- [ ] D1 database created with correct schema (`wrangler d1 list`)
- [ ] Document successfully chunked and embedded
- [ ] Query returns relevant results with citations
- [ ] Namespace filtering works correctly
- [ ] LLM generates accurate answers from context
- [ ] Source URLs included in response

### Test commands
```bash
# Upload a sample regulation
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -d '{"url": "...", "namespace": "caseworker"}'

# Query
curl "http://localhost:8787/query?text=What%20are%20home%20study%20requirements&namespace=caseworker"
```

---

## Cost Estimate

- **Free Tier**: 30M vector dimensions (~38K vectors × 768 dims), 5M queries/month
- **Expected**: ~50K vectors, ~200K queries/month
- **Monthly Cost**: ~$0.40–0.50/month (likely within free tier for learning phase)

---

## What Was Ruled Out (and Why)

| Rejected Option | Reason |
|----------------|--------|
| R2 for chunk storage | D1 access patterns are correct for small frequent reads |
| Proactive compliance scanning | Scope creep for Phase 1 |
| Cloudflare Workflows (Phase 1) | Premature automation — manual first |
| Case law integration (Phase 1) | No validated data source yet |
| Semantic chunking (Phase 1) | Start simple, iterate based on data |
| Separate namespace index | Metadata filtering is the Cloudflare best practice |
