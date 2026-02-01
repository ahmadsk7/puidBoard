# Upload Functionality Test Plan

## ✅ FIXED - Complete Upload Flow

### What Was Broken
1. **Missing WebSocket event handlers** - Client sent QUEUE_ADD but never listened for responses
2. **MIME type issues** - Browser sent `application/octet-stream` instead of `audio/mpeg`
3. **CORS configuration** - Production site couldn't connect to realtime server
4. **Environment variables** - Vercel had malformed `NEXT_PUBLIC_REALTIME_URL`

### What Was Fixed
1. **Added all WebSocket event handlers** (`apps/web/src/realtime/client.ts`)
   - QUEUE_ADD, QUEUE_REMOVE, QUEUE_REORDER
   - DECK_LOAD, DECK_PLAY, DECK_PAUSE, DECK_CUE, DECK_SEEK
   - MIXER_VALUE, CONTROL_OWNERSHIP, SYNC_TICK

2. **MIME type inference** (`apps/realtime/src/http/api.ts`)
   - Server now infers MIME type from filename if browser sends wrong type
   - Supports: .mp3, .wav, .aiff, .aif, .flac

3. **CORS properly configured**
   - Local: `http://localhost:3000`
   - Production: `https://puidboard.com`, `https://www.puidboard.com`

4. **Environment variables fixed**
   - Vercel production: `NEXT_PUBLIC_REALTIME_URL=https://puidboard-realtime.fly.dev`
   - Local dev: `NEXT_PUBLIC_REALTIME_URL=http://localhost:3001`

## 🧪 Test Local Development

1. **Start servers** (if not running):
   ```bash
   # Terminal 1 - Realtime server
   cd apps/realtime
   pnpm dev

   # Terminal 2 - Web frontend
   cd apps/web
   pnpm dev
   ```

2. **Open browser**: http://localhost:3000/room/create

3. **Upload test**:
   - Click green "+ Add" button in queue panel (right sidebar)
   - Select: `/Users/ibbybajwa/Downloads/No Hands Lyrics - Waka Flocka Flame.mp3`
   - Watch console logs for progress
   - **Expected**: Track appears in queue within 2-3 seconds

4. **Play test**:
   - Click "A" button next to the track to load to Deck A
   - Watch waveform analyze
   - Press Play button
   - **Expected**: Audio plays with waveform animation

## 🚀 Test Production

1. **Open browser**: https://puidboard.com/room/create

2. **Upload test**: Same as local

3. **Verify environment**:
   - Open browser console
   - Look for: `[RealtimeClient] connected`
   - Connection should be to: `wss://puidboard-realtime.fly.dev`

## 📊 Production Infrastructure

### Realtime Server (Fly.io)
- **URL**: https://puidboard-realtime.fly.dev
- **Instances**: 2 machines in iad region
- **Resources**: shared-cpu-1x, 512MB RAM
- **Concurrency**: 2500 hard limit, 2000 soft limit
- **Persistence**: Redis (Upstash) - configured ✅
- **Storage**: Supabase - configured ✅

### Frontend (Vercel)
- **URL**: https://puidboard.com
- **Environment**: Production
- **Build**: Turbo monorepo build
- **Environment Variables**:
  - `NEXT_PUBLIC_REALTIME_URL=https://puidboard-realtime.fly.dev` ✅

### File Storage (Supabase)
- **Bucket**: `tracks` (public)
- **CORS**: Configured for puidboard.com
- **Deduplication**: By SHA-256 hash

### Redis (Upstash)
- **Purpose**: Room state persistence
- **Configured**: Yes (via UPSTASH_REDIS_REST_* secrets)

## 🔥 Load Testing for 10k+ Users

### Current Configuration
- **2 Fly.io machines** x 2500 connections = **5000 concurrent WebSocket connections**
- **Auto-scaling**: Disabled (min_machines_running = 1, auto_stop_machines = false)

### To Scale to 10k+ Users:
1. **Horizontal scaling** (recommended):
   ```bash
   fly scale count 4 --app puidboard-realtime
   ```
   - 4 machines x 2500 connections = 10,000 concurrent users

2. **Vertical scaling** (if needed):
   ```bash
   fly scale vm shared-cpu-2x --memory 1024 --app puidboard-realtime
   ```

3. **Monitor health**:
   ```bash
   fly logs -a puidboard-realtime
   fly status -a puidboard-realtime
   ```

### Load Testing Commands
```bash
# Test upload endpoint
curl -X POST https://puidboard-realtime.fly.dev/api/tracks/upload \
  -F "file=@test.mp3" \
  -F "title=Test Track" \
  -F "durationSec=180" \
  -F "mimeType=audio/mpeg"

# Test health endpoint
curl -s https://puidboard-realtime.fly.dev/health | jq .

# Monitor WebSocket connections
fly logs -a puidboard-realtime | grep "\[connect\]"
```

## ✅ Verification Checklist

- [x] Local dev upload works
- [x] Production upload endpoint deployed
- [x] CORS configured for production
- [x] WebSocket event handlers added
- [x] MIME type inference working
- [x] Vercel environment variables fixed
- [x] Redis persistence configured
- [x] Supabase storage configured
- [x] Health checks passing
- [ ] Production upload test (manual verification needed)

## 🐛 Debugging

### Check Realtime Server Logs
```bash
# Production
fly logs -a puidboard-realtime

# Local
tail -f /tmp/realtime-server.log
```

### Check Browser Console
Look for these logs:
- `[TrackUploader] Analyzing...`
- `[TrackUploader] Uploading...`
- `[QueuePanel] Sending QUEUE_ADD event`
- `[RealtimeClient] received server event: QUEUE_ADD`

### Common Issues
1. **Track doesn't appear in queue**: Check browser console for WebSocket events
2. **CORS error**: Verify CORS_ORIGINS secret in Fly.io
3. **Upload fails**: Check file size (<50MB), format (mp3/wav/aiff/flac)
4. **No waveform**: Audio analysis runs in browser - check console errors
