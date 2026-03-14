import type { ChunkMetadata, Namespace } from './types';

export async function upsertVectors(
  vectorize: Vectorize,
  vectors: { id: string; values: number[]; metadata: ChunkMetadata }[]
): Promise<void> {
  await vectorize.upsert(vectors);
}

export async function queryVectors(
  vectorize: Vectorize,
  embedding: number[],
  topK: number,
  namespace?: Namespace
): Promise<VectorizeMatches> {
  const queryOptions: VectorizeQueryOptions = {
    topK,
    returnMetadata: 'all',
  };

  if (namespace) {
    queryOptions.filter = { namespace };
  }

  return vectorize.query(embedding, queryOptions);
}
