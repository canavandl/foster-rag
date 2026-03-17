#!/usr/bin/env tsx
/**
 * RAG Evaluation Script: source recall, answer recall
 *
 * Usage:
 *   npx tsx scripts/evaluate.ts
 *   WORKER_URL=https://... npx tsx scripts/evaluate.ts
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

interface TestCase {
  id: string;
  query: string;
  expectedSources: string[];
  expectedInAnswer: string[];
}

const TEST_CASES: TestCase[] = [
  {
    id: 'fp-01',
    query: 'What are the bedroom requirements for foster children?',
    expectedSources: ['749'],
    expectedInAnswer: ['bedroom', 'sleep'],
  },
  {
    id: 'fp-02',
    query: 'How many hours of pre-service training are required for foster parents?',
    expectedSources: ['749', 'Kinship'],
    expectedInAnswer: [],
  },
  {
    id: 'fp-03',
    query: 'What background checks are required for foster parent applicants?',
    expectedSources: ['749'],
    expectedInAnswer: ['background', 'criminal'],
  },
  {
    id: 'fp-04',
    query: 'What are the discipline rules for foster parents?',
    expectedSources: ['749'],
    expectedInAnswer: ['discipline', 'corporal', 'punishment'],
  },
  {
    id: 'cw-01',
    query: 'How often must a caseworker visit a child in foster care?',
    expectedSources: ['CPS Handbook', '6400', '7500'],
    expectedInAnswer: ['visit', 'monthly', 'contact'],
  },
  {
    id: 'cw-02',
    query: 'What must be included in a foster care service plan?',
    expectedSources: ['CPS Handbook'],
    expectedInAnswer: ['service plan', 'plan'],
  },
  {
    id: 'cw-03',
    query: 'What are the requirements for foster home verification?',
    expectedSources: ['CPS Handbook', '7000', '7500'],
    expectedInAnswer: ['verif'],
  },
  {
    id: 'lg-01',
    query: 'What documents are required to place a child in another state under ICPC?',
    expectedSources: ['ICPC'],
    expectedInAnswer: ['ICPC', 'interstate', 'compact'],
  },
  {
    id: 'lg-02',
    query: 'What is required for ICPC supervision of a placed child?',
    expectedSources: ['ICPC'],
    expectedInAnswer: ['supervis'],
  },
  {
    id: 'gn-01',
    query: 'What medical services are available for children in foster care?',
    expectedSources: ['Medical'],
    expectedInAnswer: ['medical', 'health'],
  },
  {
    id: 'gn-02',
    query: 'What rights do foster youth have when aging out of care?',
    expectedSources: ['Extended', 'handbook', 'Youth'],
    expectedInAnswer: ['age', 'extended', '18'],
  },
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

async function runQuery(query: string): Promise<QueryResult> {
  const params = new URLSearchParams({ text: query });
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

interface EvalResult {
  id: string;
  query: string;
  sourceRecall: number;
  answerRecall: number;
  topScore: number;
  sourcesReturned: number;
  pass: boolean;
}

async function main() {
  console.log(`Worker: ${WORKER_URL}\n`);
  console.log(`Running ${TEST_CASES.length} test cases...\n`);

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
      const result = await runQuery(tc.query);
      const sourceRecall = checkSourceMatch(result, tc.expectedSources);
      const answerRecall = checkAnswerMatch(result, tc.expectedInAnswer);
      const topScore = result.sources[0]?.score ?? 0;
      const pass = sourceRecall >= 0.5 && answerRecall >= 0.5 && result.sources.length > 0;

      const icon = pass ? '✓' : '✗';
      console.log(`${icon} src=${sourceRecall.toFixed(2)} ans=${answerRecall.toFixed(2)} top=${topScore.toFixed(3)}`);

      results.push({ id: tc.id, query: tc.query, sourceRecall, answerRecall, topScore, sourcesReturned: result.sources.length, pass });
    } catch (err) {
      console.log(`✗ ERROR: ${(err as Error).message}`);
      results.push({ id: tc.id, query: tc.query, sourceRecall: 0, answerRecall: 0, topScore: 0, sourcesReturned: 0, pass: false });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const avgSourceRecall = results.reduce((s, r) => s + r.sourceRecall, 0) / results.length;
  const avgAnswerRecall = results.reduce((s, r) => s + r.answerRecall, 0) / results.length;
  const avgTopScore = results.reduce((s, r) => s + r.topScore, 0) / results.length;

  console.log('\n─────────────────────────────────────────────────');
  console.log(`Passed:            ${passed}/${results.length}`);
  console.log(`Avg source recall: ${(avgSourceRecall * 100).toFixed(1)}%`);
  console.log(`Avg answer recall: ${(avgAnswerRecall * 100).toFixed(1)}%`);
  console.log(`Avg top score:     ${avgTopScore.toFixed(3)}`);

  const failing = results.filter(r => !r.pass);
  if (failing.length) {
    console.log('\nFailing cases:');
    failing.forEach(r => console.log(`  ${r.id}: src=${r.sourceRecall.toFixed(2)} ans=${r.answerRecall.toFixed(2)}`));
  }

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
