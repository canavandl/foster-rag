/**
 * Manual document ingestion script.
 * Usage: npx tsx scripts/upload-document.ts
 *
 * Set WORKER_URL to your local dev or deployed worker URL.
 */

const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8787';

interface UploadPayload {
  title: string;
  regulation_type: string;
  source_url?: string;
  effective_date?: string;
  content: string;
  namespace: 'caseworker' | 'foster_parent' | 'admin' | 'general' | 'legal';
  section?: string;
  source_type?: 'regulation' | 'policy' | 'guide';
}

async function uploadDocument(payload: UploadPayload): Promise<void> {
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
    const error = await response.text();
    throw new Error(`Upload failed (${response.status}): ${error}`);
  }

  const result = await response.json();
  console.log('Upload successful:', result);
}

// Example usage — replace with real document content
const exampleDoc: UploadPayload = {
  title: 'Foster Home Minimum Standards',
  regulation_type: '40 TAC Chapter 749',
  source_url: 'https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=40&pt=19&ch=749',
  effective_date: '2024-01-01',
  content: `SUBCHAPTER A. GENERAL INFORMATION
Section 749.1. What is the purpose of this chapter?
This chapter establishes the minimum standards for child-placing agencies that verify foster homes and adoptive homes...`,
  namespace: 'foster_parent',
  section: 'Subchapter A',
  source_type: 'regulation',
};

uploadDocument(exampleDoc).catch((err) => {
  console.error(err);
  process.exit(1);
});
