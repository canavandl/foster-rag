export type Namespace = 'caseworker' | 'foster_parent' | 'admin' | 'general' | 'legal';

export interface ChunkMetadata {
  chunk_id: number;
  regulation_type: string;
  effective_date: string;
  section: string;
  source_url: string;
  source_type: 'regulation' | 'policy' | 'guide';
  [key: string]: string | number; // allows use as VectorizeVectorMetadata
}

export interface Document {
  id?: number;
  title: string;
  regulation_type: string;
  source_url?: string;
  effective_date?: string;
}

export interface Chunk {
  id?: number;
  document_id: number;
  content: string;
  chunk_index: number;
  namespace: Namespace;
  metadata_json?: string;
}

export interface QueryRequest {
  text: string;
  namespace?: Namespace;
  topK?: number;
}

export interface QueryResult {
  answer: string;
  sources: SourceCitation[];
}

export interface SourceCitation {
  chunk_id: number;
  title: string;
  section: string;
  source_url: string;
  regulation_type: string;
  score: number;
}

export interface UploadRequest {
  title: string;
  regulation_type: string;
  source_url?: string;
  effective_date?: string;
  content: string;
  namespace: Namespace;
  section?: string;
  source_type?: 'regulation' | 'policy' | 'guide';
}

export interface Env {
  VECTORIZE: Vectorize;
  DB: D1Database;
  AI: Ai;
}
