#!/usr/bin/env tsx
/**
 * Ingestion script: reads docs/ directory and uploads each document
 * to the RAG Worker's /upload endpoint.
 *
 * Usage:
 *   npx tsx scripts/ingest-docs.ts [--remote]
 *
 * --remote  Use deployed worker URL (set WORKER_URL env var)
 *           Default: http://localhost:8787
 */

import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';
const DOCS_DIR = path.resolve(process.cwd(), 'docs');

type Namespace = 'caseworker' | 'foster_parent' | 'admin' | 'general' | 'legal';
type SourceType = 'regulation' | 'policy' | 'guide';

interface DocConfig {
  file: string;
  title: string;
  regulation_type: string;
  namespace: Namespace;
  section: string;
  source_type: SourceType;
  source_url: string;
  effective_date?: string;
}

const DOC_CONFIGS: DocConfig[] = [
  {
    file: 'chapter-749-cpa.pdf',
    title: 'Minimum Standards for Child-Placing Agencies (40 TAC Chapter 749)',
    regulation_type: '40 TAC Chapter 749',
    namespace: 'foster_parent',
    section: 'Full Chapter',
    source_type: 'regulation',
    source_url: 'https://www.hhs.texas.gov/sites/default/files/documents/doing-business-with-hhs/provider-portal/protective-services/ccl/min-standards/chapter-749-cpa.pdf',
    effective_date: '2024-01-01',
  },
  {
    file: 'chapter-749-rule-changes-dec-2024.pdf',
    title: '40 TAC Chapter 749 Rule Changes (December 2024)',
    regulation_type: '40 TAC Chapter 749',
    namespace: 'admin',
    section: 'December 2024 Amendments',
    source_type: 'regulation',
    source_url: 'https://www.hhs.texas.gov/sites/default/files/documents/chapter-749-rule-changes-dec-2024.pdf',
    effective_date: '2024-12-01',
  },
  {
    file: 'Foster_and_Licensed_Facility_Placements_Resource_Guide.pdf',
    title: 'Foster and Licensed Facility Placements Resource Guide',
    regulation_type: 'CPS Resource Guide',
    namespace: 'caseworker',
    section: 'Foster and Licensed Facility Placements',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Resource_Guides/Foster_and_Licensed_Facility_Placements_Resource_Guide.pdf',
    effective_date: '2024-07-01',
  },
  {
    file: 'Extended_Foster_Care_Resource_Guide.pdf',
    title: 'Extended Foster Care Resource Guide',
    regulation_type: 'CPS Resource Guide',
    namespace: 'general',
    section: 'Extended Foster Care (Ages 18–23)',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Resource_Guides/Extended_Foster_Care_Resource_Guide.pdf',
  },
  {
    file: 'Services_to_Kinship_Caregivers_Resource_Guide.pdf',
    title: 'Services to Kinship Caregivers Resource Guide',
    regulation_type: 'CPS Resource Guide',
    namespace: 'foster_parent',
    section: 'Kinship Caregiver Services',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Resource_Guides/Services_to_Kinship_Caregivers_Resource_Guide.pdf',
  },
  {
    file: 'Medical_Services_Resource_Guide.pdf',
    title: 'Medical Services Resource Guide',
    regulation_type: 'CPS Resource Guide',
    namespace: 'general',
    section: 'Medical Services',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Resource_Guides/Medical_Services_Resource_Guide.pdf',
  },
  {
    file: 'ICPC_Resource_Guide.pdf',
    title: 'Interstate Compact on the Placement of Children (ICPC) Resource Guide',
    regulation_type: 'CPS Resource Guide',
    namespace: 'legal',
    section: 'ICPC Procedures',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Resource_Guides/ICPC_Resource_Guide.pdf',
  },
  {
    file: 'foster-care-handbook-youth.pdf',
    title: 'Texas Foster Care Handbook for Children, Youth, and Young Adults',
    regulation_type: 'DFPS Foster Care Handbook',
    namespace: 'general',
    section: 'Youth Rights and Services',
    source_type: 'guide',
    source_url: 'https://www.dfps.texas.gov/Child_Protection/Youth_and_Young_Adults/Transitional_Living/documents/foster-care-handbook.pdf',
    effective_date: '2024-05-01',
  },
  {
    file: 'CPS_pg_6000.html',
    title: 'CPS Handbook §6000: Substitute Care Services',
    regulation_type: 'CPS Policy Handbook',
    namespace: 'caseworker',
    section: '§6000 Substitute Care Services',
    source_type: 'policy',
    source_url: 'https://www.dfps.texas.gov/handbooks/cps/files/CPS_pg_6000.asp',
  },
  {
    file: 'CPS_pg_6400.html',
    title: 'CPS Handbook §6400: Services to Children in Substitute Care',
    regulation_type: 'CPS Policy Handbook',
    namespace: 'caseworker',
    section: '§6400 Services to Children in Substitute Care',
    source_type: 'policy',
    source_url: 'https://www.dfps.texas.gov/handbooks/cps/files/CPS_pg_6400.asp',
  },
  {
    file: 'CPS_pg_7000.html',
    title: 'CPS Handbook §7000: Foster and Adoptive Home Development',
    regulation_type: 'CPS Policy Handbook',
    namespace: 'caseworker',
    section: '§7000 Foster and Adoptive Home Development',
    source_type: 'policy',
    source_url: 'https://www.dfps.texas.gov/handbooks/cps/files/CPS_pg_7000.asp',
  },
  {
    file: 'CPS_pg_7500.html',
    title: 'CPS Handbook §7500: Foster Home Assessment and Management',
    regulation_type: 'CPS Policy Handbook',
    namespace: 'caseworker',
    section: '§7500 Foster Home Assessment and Management',
    source_type: 'policy',
    source_url: 'https://www.dfps.texas.gov/handbooks/CPS/Files/CPS_pg_7500.asp',
  },
];

async function extractPdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  let pageNum = 0;

  const data = await pdf(buffer, {
    pagerender: async (pageData: any) => {
      pageNum++;
      const textContent = await pageData.getTextContent();
      let text = '';
      let sep = '';
      for (const item of textContent.items as Array<{ str: string }>) {
        if (item.str === '') { sep = '\n'; }
        else { text += sep + item.str; sep = ''; }
      }
      return `<<<PAGE:${pageNum}>>> ${text} `;
    },
  });

  return data.text;
}

function extractHtml(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return raw
    // Remove script and style blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Replace block elements with newlines to preserve structure
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|br|section|article)>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractText(config: DocConfig): Promise<string> {
  const filePath = path.join(DOCS_DIR, config.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  if (config.file.endsWith('.pdf')) {
    return extractPdf(filePath);
  }
  return extractHtml(filePath);
}

// Max words per upload request — keeps Worker well within CPU time limits
const MAX_WORDS_PER_REQUEST = 20_000;

function splitIntoSegments(content: string): string[] {
  const words = content.split(/\s+/);
  if (words.length <= MAX_WORDS_PER_REQUEST) return [content];
  const segments: string[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_REQUEST) {
    segments.push(words.slice(i, i + MAX_WORDS_PER_REQUEST).join(' '));
  }
  return segments;
}

async function uploadSegment(config: DocConfig, content: string, part?: number): Promise<{ document_id: number; chunks_created: number }> {
  const title = part !== undefined ? `${config.title} (Part ${part})` : config.title;
  const payload = {
    title,
    regulation_type: config.regulation_type,
    source_url: config.source_url,
    effective_date: config.effective_date,
    content,
    namespace: config.namespace,
    section: config.section,
    source_type: config.source_type,
  };

  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  // Add auth header if UPLOAD_API_KEY is set
  const apiKey = process.env.UPLOAD_API_KEY;
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${WORKER_URL}/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload failed (${response.status}): ${err}`);
  }

  return response.json() as Promise<{ document_id: number; chunks_created: number }>;
}

async function uploadDoc(config: DocConfig, content: string): Promise<void> {
  const segments = splitIntoSegments(content);
  let totalChunks = 0;
  for (let i = 0; i < segments.length; i++) {
    const part = segments.length > 1 ? i + 1 : undefined;
    const result = await uploadSegment(config, segments[i], part);
    totalChunks += result.chunks_created;
    if (segments.length > 1) {
      process.stdout.write(`\n    part ${i + 1}/${segments.length}: document_id=${result.document_id}  chunks=${result.chunks_created}`);
    }
  }
  console.log(`  ✓ chunks=${totalChunks}`);
}

async function main() {
  console.log(`Worker: ${WORKER_URL}`);
  console.log(`Docs:   ${DOCS_DIR}\n`);

  // Check worker is up
  try {
    const health = await fetch(`${WORKER_URL}/health`);
    if (!health.ok) throw new Error(`health check returned ${health.status}`);
  } catch (err) {
    console.error('Worker not reachable. Start it with: npm run dev');
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;

  for (const config of DOC_CONFIGS) {
    process.stdout.write(`[${config.namespace.padEnd(12)}] ${config.file} ... `);
    try {
      const content = await extractText(config);
      const wordCount = content.split(/\s+/).length;
      process.stdout.write(`${wordCount.toLocaleString()} words → `);
      await uploadDoc(config, content);
      passed++;
    } catch (err) {
      console.log(`\n  ✗ ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${passed} succeeded, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
