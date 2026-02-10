# WebM Upload Bug - Root Cause & Permanent Fix

## Problem Summary
The error `"Upload failed: mime type audio/webm is not supported"` keeps appearing even though the code has been fixed multiple times.

**Root Cause:** The production server (`puidboard-realtime.fly.dev`) is running **old code**. The fixes exist in the codebase but were **never deployed**.

## Timeline of Fixes

### Commit `68f1e31` (Feb 2) - Original Implementation
- **Bug:** Used exact matching: `ALLOWED_MIME_TYPES.includes(input.mimeType)`
- **Problem:** Failed for `"audio/webm;codecs=opus"` (includes codec parameters)

### Commit `f3d2f0a` (Feb 7) - First Fix
- **Fixed:** Changed to prefix matching: `input.mimeType.startsWith(prefix)`
- **Added:** WebM/OGG/MP4 to storage service mime type mappings
- **Status:** ✅ Committed to git, ❌ **NEVER DEPLOYED**

### This Fix (Today) - Additional Safety Layers
- **Added:** Mime type normalization (strips codec parameters)
- **Added:** Enhanced logging for debugging
- **Added:** Health check endpoint with version tracking
- **Status:** ✅ Ready to deploy

## What This Fix Does

### 1. Mime Type Normalization
```typescript
// Before: "audio/webm;codecs=opus" would fail exact match
// After: Normalize to "audio/webm" before validation
const baseMimeType = input.mimeType.split(";")[0]!.trim().toLowerCase();
```

### 2. Enhanced Logging
```typescript
console.log(`[samplerSounds] Normalized MIME type: "${input.mimeType}" -> "${baseMimeType}"`);
```
This helps debug issues immediately without guessing.

### 3. Health Check Endpoint
Visit `https://puidboard-realtime.fly.dev/api/health` to verify:
- Which version is deployed
- What formats are supported
- Deployment timestamp

## Deployment Instructions

### Step 1: Build the TypeScript code
```bash
cd /Users/ibbybajwa/puidBoard
pnpm build --filter=@puid-board/realtime
```

### Step 2: Deploy to Fly.io
```bash
cd apps/realtime
fly deploy --app puidboard-realtime
```

### Step 3: Verify the deployment
```bash
# Check the health endpoint
curl https://puidboard-realtime.fly.dev/api/health

# Should return:
# {
#   "status": "ok",
#   "version": "1.0.0-webm-fix",
#   "features": {
#     "samplerFormats": ["MP3", "WAV", "OGG", "WebM", "M4A"],
#     ...
#   }
# }
```

### Step 4: Test the sampler upload
1. Go to https://puidboard.com (or your frontend URL)
2. Open sampler settings
3. Record audio (creates WebM file)
4. Upload should succeed
5. Check browser console - should see `[SamplerSettings] Upload success`

## Why This Won't Break Again

### 1. Normalization Layer
Even if the frontend sends mime types with codec parameters, the backend normalizes them before validation.

### 2. Comprehensive Logging
Every step of the upload process is logged:
- Incoming mime type
- Normalized mime type
- Validation result
- Upload result

### 3. Health Check
You can verify what code is running in production at any time by visiting `/api/health`.

### 4. Version Tracking
Update the version string in `api.ts` line 833 whenever you deploy a fix:
```typescript
version: "1.0.0-webm-fix",  // Increment this on each deploy
```

## Supported Formats

After this fix, the sampler accepts:
- **MP3** (`audio/mpeg`)
- **WAV** (`audio/wav`, `audio/x-wav`)
- **OGG** (`audio/ogg`, `audio/ogg;codecs=opus`)
- **WebM** (`audio/webm`, `audio/webm;codecs=opus`)
- **M4A/AAC** (`audio/mp4`)

All formats work with or without codec parameters (e.g., `;codecs=opus`).

## Files Changed

1. **apps/realtime/src/services/samplerSounds.ts**
   - Added mime type normalization
   - Enhanced validation logging

2. **apps/realtime/src/http/api.ts**
   - Added health check endpoint
   - Enhanced upload logging
   - Version tracking

## Testing Checklist

After deployment, test:
- [ ] Health endpoint returns correct version
- [ ] Upload MP3 file ✓
- [ ] Upload WAV file ✓
- [ ] Record audio (WebM) ✓
- [ ] Upload OGG file ✓
- [ ] Check server logs for proper logging
- [ ] Verify error messages are helpful

## Future Prevention

1. **Always deploy after fixing bugs** - Don't just commit!
2. **Check health endpoint** - Verify version before testing
3. **Monitor logs** - Enhanced logging helps catch issues early
4. **Test in production** - Use the health check to verify deployment

## Quick Deploy Command

```bash
# From project root
pnpm build --filter=@puid-board/realtime && \
cd apps/realtime && \
fly deploy --app puidboard-realtime && \
curl https://puidboard-realtime.fly.dev/api/health
```

---

**Last Updated:** 2026-02-10
**Deploy Status:** ⏳ Waiting for deployment
**When Deployed:** Update this to ✅ DEPLOYED
