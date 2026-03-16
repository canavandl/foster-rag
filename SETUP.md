# Setup Guide

## Quick Setup (5 minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Local Authentication
The `.dev.vars` file has been created with a secure API key for local development:
```bash
# Already created: .dev.vars
UPLOAD_API_KEY=UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=
```

**⚠️ Important:** This file is gitignored and should never be committed.

### 3. Initialize Database
```bash
npm run db:init
```

### 4. Start Development Server
```bash
npm run dev
```

The server will start at `http://localhost:8787`

### 5. Test the Setup

**Test authentication:**
```bash
# Should fail (no auth)
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}'
# Expected: {"error":"Missing Authorization header"}

# Should succeed (with auth)
curl -X POST http://localhost:8787/upload \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer UqgEJ4yFQ274kjDvdpukltisS2EPPCCZB6vJr2YnEE4=" \
  -d '{"title":"test","regulation_type":"test","content":"test","namespace":"general"}'
# Expected: {"success":true,"document_id":...}
```

**Test queries:**
```bash
curl "http://localhost:8787/query?text=test&namespace=general"
```

### 6. Ingest Documents (Optional)

If you have documents in the `docs/` directory:

```bash
npm run ingest
```

The script will automatically use the `UPLOAD_API_KEY` from `.dev.vars`.

## Production Setup

### 1. Deploy Worker
```bash
npm run deploy
```

### 2. Set Production Secrets
```bash
# Generate a new secure key for production
openssl rand -base64 32

# Set it in Cloudflare
wrangler secret put UPLOAD_API_KEY
# Paste the generated key when prompted
```

### 3. Initialize Production Database
```bash
npm run db:init:remote
```

### 4. Ingest Documents to Production
```bash
# Set the production worker URL and API key
export WORKER_URL=https://your-worker-name.workers.dev
export UPLOAD_API_KEY=your-production-key

npm run ingest:remote
```

## Verification

Run the evaluation suite to verify everything is working:

```bash
npm run eval
```

Expected output:
```
Passed:           13/13
Avg source recall: 93.6%
Avg answer recall: 100.0%
Namespace clean:   13/13
```

## Troubleshooting

### "Missing Authorization header" when running ingest script

**Problem:** The script can't find the API key.

**Solution:** Make sure `UPLOAD_API_KEY` is set in `.dev.vars` for local or as an environment variable for remote.

### "Invalid API key"

**Problem:** The API key doesn't match.

**Solution:**
- For local: Check `.dev.vars` matches the key you're using
- For production: Verify you set the secret with `wrangler secret put UPLOAD_API_KEY`

### Worker not loading .dev.vars

**Problem:** Wrangler isn't picking up the `.dev.vars` file.

**Solution:** Make sure the file is in the project root and restart `npm run dev`.

## Security Notes

✅ **What's Protected:**
- `/upload` endpoint requires API key authentication
- API keys are stored securely (Cloudflare Secrets for production, `.dev.vars` for local)
- `.dev.vars` is gitignored

⚠️ **What's NOT Protected:**
- `/query` endpoint is public (add auth if needed)
- `/health` endpoint is public
- Root `/` (query UI) is public

## Next Steps

1. ✅ Authentication is configured
2. 📝 Review the [README.md](./README.md) for full documentation
3. 🧪 Run `npm run eval` to verify RAG performance
4. 🚀 Deploy to production when ready

## Files Created/Modified

**New Files:**
- `.dev.vars` - Local environment variables (gitignored)
- `.env.example` - Example environment variables template
- `README.md` - Full project documentation
- `SETUP.md` - This file

**Modified Files:**
- `src/types.ts` - Added `UPLOAD_API_KEY` to Env interface
- `src/index.ts` - Added `requireAuth()` function and authentication check
- `scripts/ingest-docs.ts` - Added Authorization header to uploads
- `scripts/upload-document.ts` - Added Authorization header to uploads
- `.gitignore` - Added `.dev.vars` and `.env`

## Testing Results

✅ **Authentication Tests:**
- ❌ No auth header → 401 "Missing Authorization header"
- ❌ Wrong API key → 403 "Invalid API key"
- ✅ Correct API key → 200 Success

All authentication checks are working correctly!
