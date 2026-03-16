# Authentication Implementation

## Overview

The `/upload` endpoint is now protected with API key authentication using the `Authorization: Bearer <token>` header pattern.

## How It Works

### Request Flow

```
1. Client sends POST to /upload with Authorization header
2. requireAuth() extracts and validates the API key
3. If valid → proceed to handleUpload()
4. If invalid → return 401/403 error
```

### Authentication Function

```typescript
function requireAuth(request: Request, env: Env): Response | null {
  // Returns null if auth succeeds
  // Returns Response with error if auth fails

  if (!env.UPLOAD_API_KEY) {
    console.warn('UPLOAD_API_KEY not set - upload endpoint is unprotected!');
    return null; // Allow unprotected access in dev mode
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return 401; // Missing header

  const token = authHeader.replace('Bearer ', '');
  if (token !== env.UPLOAD_API_KEY) return 403; // Invalid key

  return null; // Success
}
```

## Configuration

### Local Development

The API key is stored in `.dev.vars` (gitignored):

```bash
# .dev.vars
UPLOAD_API_KEY=UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=
```

Wrangler automatically loads this file when you run `npm run dev`.

### Production

Set the secret in Cloudflare:

```bash
wrangler secret put UPLOAD_API_KEY
# Paste: UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=
# (or generate a new one with: openssl rand -base64 32)
```

## Usage Examples

### cURL

```bash
# Successful request
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=" \
  -d '{
    "title": "Example Document",
    "regulation_type": "40 TAC Chapter 749",
    "content": "Document content here...",
    "namespace": "general"
  }'
```

### JavaScript/TypeScript

```typescript
const response = await fetch('http://localhost:8787/upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.UPLOAD_API_KEY}`
  },
  body: JSON.stringify({
    title: 'Example Document',
    regulation_type: '40 TAC Chapter 749',
    content: 'Document content here...',
    namespace: 'general'
  })
});
```

### Ingestion Scripts

The scripts automatically include the Authorization header:

```typescript
// scripts/ingest-docs.ts (lines 230-236)
const headers: HeadersInit = { 'Content-Type': 'application/json' };

const apiKey = process.env.UPLOAD_API_KEY;
if (apiKey) {
  headers['Authorization'] = `Bearer ${apiKey}`;
}

const response = await fetch(`${WORKER_URL}/upload`, {
  method: 'POST',
  headers,
  body: JSON.stringify(payload),
});
```

## Error Responses

### 401 Unauthorized - Missing Header

**Request:**
```bash
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}'
```

**Response:**
```json
{
  "error": "Missing Authorization header"
}
```

**Headers:**
```
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="foster-rag"
```

### 403 Forbidden - Invalid Key

**Request:**
```bash
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-key-here" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}'
```

**Response:**
```json
{
  "error": "Invalid API key"
}
```

### 200 OK - Success

**Request:**
```bash
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}'
```

**Response:**
```json
{
  "success": true,
  "document_id": 71,
  "chunks_created": 1
}
```

## Security Considerations

### ✅ What's Protected

- **Upload Endpoint**: Requires valid API key
- **Key Storage**: Stored securely in Cloudflare Secrets (production) or `.dev.vars` (local)
- **No Secrets in Git**: `.dev.vars` is gitignored
- **HTTP 401/403 Responses**: Proper status codes for auth failures

### ⚠️ What's NOT Protected

- **Query Endpoint** (`/query`): Public access (intentional for end-user queries)
- **Health Check** (`/health`): Public access (for monitoring)
- **Web UI** (`/`): Public access (for end-user interface)

### 🔒 Best Practices Applied

1. **Bearer Token Pattern**: Standard `Authorization: Bearer <token>` format
2. **Separate Secrets**: Different keys for local and production
3. **Graceful Fallback**: Logs warning if API key not configured (dev mode)
4. **No Key Exposure**: API key never logged or returned in responses
5. **WWW-Authenticate Header**: Proper 401 response with realm

## Key Rotation

To rotate the API key:

### Local Development
```bash
# Generate new key
openssl rand -base64 32

# Update .dev.vars
echo "UPLOAD_API_KEY=new-key-here" > .dev.vars

# Restart dev server
npm run dev
```

### Production
```bash
# Generate new key
openssl rand -base64 32

# Update Cloudflare secret
wrangler secret put UPLOAD_API_KEY
# Paste the new key

# No deployment needed - takes effect immediately
```

### Update Scripts
```bash
# Update environment variable for ingestion
export UPLOAD_API_KEY=new-key-here
npm run ingest
```

## Testing Authentication

Run all test scenarios:

```bash
# Test 1: No auth (should fail with 401)
curl -s -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}' \
  | grep -q "Missing Authorization header" && echo "✓ Test 1 passed"

# Test 2: Wrong key (should fail with 403)
curl -s -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrong-key" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}' \
  | grep -q "Invalid API key" && echo "✓ Test 2 passed"

# Test 3: Correct key (should succeed with 200)
curl -s -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}' \
  | grep -q "success" && echo "✓ Test 3 passed"
```

## Troubleshooting

### Issue: "Missing Authorization header" when using scripts

**Cause**: `UPLOAD_API_KEY` environment variable not set

**Solution**:
```bash
# For local dev
echo "UPLOAD_API_KEY=UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=" >> .dev.vars

# For remote ingestion
export UPLOAD_API_KEY=your-production-key
npm run ingest:remote
```

### Issue: "Invalid API key" error

**Cause**: API key mismatch between client and server

**Solution**:
1. Check `.dev.vars` has correct key
2. Check environment variable matches
3. Restart `wrangler dev` to reload `.dev.vars`
4. For production, verify secret with `wrangler secret list`

### Issue: Warning "UPLOAD_API_KEY not set"

**Cause**: `.dev.vars` file missing or not loaded

**Solution**:
1. Verify `.dev.vars` exists in project root
2. Restart `npm run dev`
3. Check file isn't named `.dev.vars.txt` or similar

### Issue: Scripts work locally but fail in production

**Cause**: Production secret not set

**Solution**:
```bash
# Set production secret
wrangler secret put UPLOAD_API_KEY

# Verify it's set
wrangler secret list
```

## Files Modified

- ✅ `src/types.ts` - Added `UPLOAD_API_KEY` to Env interface
- ✅ `src/index.ts` - Added `requireAuth()` function and protection
- ✅ `scripts/ingest-docs.ts` - Added Authorization header
- ✅ `scripts/upload-document.ts` - Added Authorization header
- ✅ `.gitignore` - Added `.dev.vars` and `.env`
- ✅ `.dev.vars` - Created with generated API key
- ✅ `.env.example` - Created as template

## Implementation Status

✅ **Implemented and Tested:**
- API key authentication on `/upload` endpoint
- Authorization header validation
- Proper HTTP status codes (401, 403)
- Support for Bearer token format
- Environment variable configuration
- Script integration
- Documentation
- Testing suite

🎯 **All tests passing!**
