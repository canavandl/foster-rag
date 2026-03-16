#!/usr/bin/env tsx
/**
 * RAG Evaluation Script: precision@5, recall@5, namespace accuracy
 *
 * Usage:
 *   npx tsx scripts/evaluate.ts
 *   WORKER_URL=https://... npx tsx scripts/evaluate.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

type Namespace = 'caseworker' | 'foster_parent' | 'admin' | 'general' | 'legal';

interface TestCase {
  id: string;
  query: string;
  namespace?: Namespace;
  // Strings that MUST appear in at least one source title or the answer
  expectedSources: string[];
  // Strings that must appear in the answer text
  expectedInAnswer: string[];
  // Sources that should NOT appear (wrong namespace bleed)
  forbiddenSources?: string[];
}

const TEST_CASES: TestCase[] = [
  // --- foster_parent namespace ---
  {
    id: 'fp-01',
    query: 'What are the bedroom requirements for foster children?',
    namespace: 'foster_parent',
    expectedSources: ['749'],
    expectedInAnswer: ['bedroom', 'sleep'],
    forbiddenSources: ['CPS Handbook'],
  },
  {
    id: 'fp-02',
    query: 'How many hours of pre-service training are required for foster parents?',
    namespace: 'foster_parent',
    expectedSources: ['749', 'Kinship'],
    expectedInAnswer: [],
  },
  {
    id: 'fp-03',
    query: 'What background checks are required for foster parent applicants?',
    namespace: 'foster_parent',
    expectedSources: ['749'],
    expectedInAnswer: ['background', 'criminal'],
  },
  {
    id: 'fp-04',
    query: 'What are the discipline rules for foster parents?',
    namespace: 'foster_parent',
    expectedSources: ['749'],
    expectedInAnswer: ['discipline', 'corporal', 'punishment'],
  },

  // --- caseworker namespace ---
  {
    id: 'cw-01',
    query: 'How often must a caseworker visit a child in foster care?',
    namespace: 'caseworker',
    expectedSources: ['CPS Handbook', '6400', '7500'],
    expectedInAnswer: ['visit', 'monthly', 'contact'],
    forbiddenSources: ['749'],
  },
  {
    id: 'cw-02',
    query: 'What must be included in a foster care service plan?',
    namespace: 'caseworker',
    expectedSources: ['CPS Handbook'],
    expectedInAnswer: ['service plan', 'plan'],
  },
  {
    id: 'cw-03',
    query: 'What are the requirements for foster home verification?',
    namespace: 'caseworker',
    expectedSources: ['CPS Handbook', '7000', '7500'],
    expectedInAnswer: ['verif'],
  },

  // --- legal namespace ---
  {
    id: 'lg-01',
    query: 'What documents are required to place a child in another state under ICPC?',
    namespace: 'legal',
    expectedSources: ['ICPC'],
    expectedInAnswer: ['ICPC', 'interstate', 'compact'],
    forbiddenSources: ['749', 'CPS Handbook §6'],
  },
  {
    id: 'lg-02',
    query: 'What is required for ICPC supervision of a placed child?',
    namespace: 'legal',
    expectedSources: ['ICPC'],
    expectedInAnswer: ['supervis'],
  },

  // --- general namespace ---
  {
    id: 'gn-01',
    query: 'What medical services are available for children in foster care?',
    namespace: 'general',
    expectedSources: ['Medical'],
    expectedInAnswer: ['medical', 'health'],
  },
  {
    id: 'gn-02',
    query: 'What rights do foster youth have when aging out of care?',
    namespace: 'general',
    expectedSources: ['Extended', 'handbook', 'Youth'],
    expectedInAnswer: ['age', 'extended', '18'],
  },

  // --- no namespace (cross-cutting) ---
  {
    id: 'xc-01',
    query: 'What are the minimum age requirements for foster parents in Texas?',
    expectedSources: ['749'],
    expectedInAnswer: ['age', 'year'],
  },
  {
    id: 'xc-02',
    query: 'What are the requirements for kinship caregivers?',
    expectedSources: ['Kinship'],
    expectedInAnswer: ['kinship'],
  },
];

interface QueryResult {
  answer: string;
  sources: { chunk_id: number; title: string; section: string; source_url: string; regulation_type: string; score: number }[];
}

async function runQuery(query: string, namespace?: Namespace): Promise<QueryResult> {
  const params = new URLSearchParams({ text: query });
  if (namespace) params.set('namespace', namespace);
  const res = await fetch(`${WORKER_URL}/query?${params}`);
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  return res.json() as Promise<QueryResult>;
}

function checkSourceMatch(result: QueryResult, expected: string[]): number {
  if (expected.length === 0) return 1;
  const allText = result.sources.map(s => `${s.title} ${s.regulation_type} ${s.section}`).join(' ').toLowerCase();
  const matched = expected.filter(e => allText.includes(e.toLowerCase()));
  return matched.length / expected.length;
}

function checkAnswerMatch(result: QueryResult, expected: string[]): number {
  if (expected.length === 0) return 1;
  const answerLower = result.answer.toLowerCase();
  const matched = expected.filter(e => answerLower.includes(e.toLowerCase()));
  return matched.length / expected.length;
}

function checkForbidden(result: QueryResult, forbidden: string[]): boolean {
  if (!forbidden?.length) return true;
  const allText = result.sources.map(s => `${s.title} ${s.regulation_type}`).join(' ').toLowerCase();
  return !forbidden.some(f => allText.includes(f.toLowerCase()));
}

interface EvalResult {
  id: string;
  query: string;
  namespace?: string;
  sourceRecall: number;
  answerRecall: number;
  namespaceClean: boolean;
  topScore: number;
  sourcesReturned: number;
  pass: boolean;
}

async function main() {
  console.log(`Worker: ${WORKER_URL}\n`);
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

  // Check worker is up
  try {
    await fetch(`${WORKER_URL}/health`);
  } catch {
    console.error('Worker not reachable. Start it with: npm run dev');
    process.exit(1);
  }

  const results: EvalResult[] = [];

  for (const tc of TEST_CASES) {
    process.stdout.write(`[${tc.id}] ${tc.query.substring(0, 55).padEnd(55)} `);
    try {
      const result = await runQuery(tc.query, tc.namespace);
      const sourceRecall = checkSourceMatch(result, tc.expectedSources);
      const answerRecall = checkAnswerMatch(result, tc.expectedInAnswer);
      const namespaceClean = checkForbidden(result, tc.forbiddenSources ?? []);
      const topScore = result.sources[0]?.score ?? 0;
      const pass = sourceRecall >= 0.5 && answerRecall >= 0.5 && namespaceClean && result.sources.length > 0;

      const icon = pass ? '✓' : '✗';
      console.log(`${icon} src=${sourceRecall.toFixed(2)} ans=${answerRecall.toFixed(2)} ns=${namespaceClean ? 'ok' : 'BLEED'} top=${topScore.toFixed(3)}`);

      results.push({ id: tc.id, query: tc.query, namespace: tc.namespace, sourceRecall, answerRecall, namespaceClean, topScore, sourcesReturned: result.sources.length, pass });
    } catch (err) {
      console.log(`✗ ERROR: ${(err as Error).message}`);
      results.push({ id: tc.id, query: tc.query, namespace: tc.namespace, sourceRecall: 0, answerRecall: 0, namespaceClean: false, topScore: 0, sourcesReturned: 0, pass: false });
    }
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const avgSourceRecall = results.reduce((s, r) => s + r.sourceRecall, 0) / results.length;
  const avgAnswerRecall = results.reduce((s, r) => s + r.answerRecall, 0) / results.length;
  const avgTopScore = results.reduce((s, r) => s + r.topScore, 0) / results.length;
  const nsClean = results.filter(r => r.namespaceClean).length;

  console.log('\n─────────────────────────────────────────────────');
  console.log(`Passed:           ${passed}/${results.length}`);
  console.log(`Avg source recall: ${(avgSourceRecall * 100).toFixed(1)}%`);
  console.log(`Avg answer recall: ${(avgAnswerRecall * 100).toFixed(1)}%`);
  console.log(`Avg top score:     ${avgTopScore.toFixed(3)}`);
  console.log(`Namespace clean:   ${nsClean}/${results.filter(r => r.forbiddenSources?.length).length + (results.length - results.filter(r => r.forbiddenSources?.length).length)} (${results.filter(r => r.pass && !r.namespaceClean).length} bleed)`);

  const failing = results.filter(r => !r.pass);
  if (failing.length) {
    console.log('\nFailing cases:');
    failing.forEach(r => console.log(`  ${r.id}: src=${r.sourceRecall.toFixed(2)} ans=${r.answerRecall.toFixed(2)} ns=${r.namespaceClean}`));
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
