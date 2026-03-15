# YouTube Fix Summary - February 14, 2026

## ✅ What We Tested

### RapidAPI youtube-mp36 (FAILED ❌)

```bash
# Test Request
curl "https://youtube-mp36.p.rapidapi.com/dl?id=dQw4w9WgXcQ" \
  -H "X-RapidAPI-Key: YOUR_KEY"

# Response
{
  "status": "ok",
  "link": "https://gamma.123tokyo.xyz/get.php/1/bb/dQw4w9WgXcQ.mp3?...",
  "duration": 212.06
}

# Test Actual MP3 Link
curl -I "https://gamma.123tokyo.xyz/get.php/..."
HTTP/2 404  ← LINK IS DEAD!
```

**Verdict:** RapidAPI returns valid JSON but the MP3 URLs return 404. Service is broken.

---

## ✅ What We're Implementing

### yt-dlp with Binary Installation (RECOMMENDED)

**Change Made:**
```dockerfile
# apps/realtime/Dockerfile (line 6)
- RUN apk add --no-cache python3 ffmpeg
+ RUN apk add --no-cache python3 ffmpeg yt-dlp
```

**Why This Works:**
- ✅ yt-dlp binary is now available in container
- ✅ youtube-dl-exec package can call the binary
- ✅ Cookie system already implemented (auto-refreshes every 6 hours)
- ✅ Streaming proxy already implemented
- ✅ Client already supports buffered download

**Architecture:**
```
Client → /api/youtube/stream/:videoId
    ↓
Server: yt-dlp --cookies youtube-cookies.txt (extracts audio URL)
    ↓
Server: Fetch from Google Video servers
    ↓
Server: Stream to client with CORS headers
    ↓
Client: Download full audio → Decode to AudioBuffer
    ↓
Client: Analyze (waveform + BPM) → Play
```

---

## 🚀 Deployment Steps

### 1. Build Locally (Verify)
```bash
# From monorepo root
pnpm build --filter=@puid-board/realtime...
```

### 2. Deploy to Fly.io
```bash
cd apps/realtime
flyctl deploy
```

### 3. Monitor Deployment
```bash
# Watch logs
flyctl logs --app puidboard-realtime

# Look for:
# [YouTube Cookies] Fetching fresh cookies from API...
# [YouTube Cookies] ✓ Fresh cookies written to /app/.storage/youtube-cookies.txt
# [YouTube] Using cookies from: /app/.storage/youtube-cookies.txt
# [YouTube] ✓ Selected format: 140 (m4a)
```

### 4. Test in Production
```bash
# Test search
curl "https://puidboard-realtime.fly.dev/api/youtube/search?q=never+gonna+give+you+up"

# Test streaming
curl "https://puidboard-realtime.fly.dev/api/youtube/stream/dQw4w9WgXcQ" > test.m4a

# Verify file downloaded
ls -lh test.m4a
ffplay test.m4a  # Should play audio
```

---

## 🔧 What Changed

### File: `apps/realtime/Dockerfile`
- Added `yt-dlp` to Alpine package installation
- This installs the yt-dlp binary needed by youtube-dl-exec

### No Code Changes Required
- Cookie system already implemented (youtube-cookies.ts)
- Streaming proxy already implemented (api.ts)
- Client buffered download already implemented (deck.ts)
- Everything was ready, just missing the binary!

---

## 🎯 Expected Outcome

### Success Indicators
- ✅ YouTube search returns results
- ✅ Loading YouTube track shows download progress
- ✅ Audio plays with full DJ controls
- ✅ BPM detection works
- ✅ Waveform displays correctly
- ✅ Multiplayer sync works

### If It Still Fails

**Check Logs:**
```bash
flyctl logs --app puidboard-realtime | grep -i "youtube\|error"
```

**Common Issues:**
1. **Cookie API down** → Check if http://185.158.132.66:1234/golden-cookies/ytc is accessible
2. **yt-dlp can't find binary** → SSH into container: `flyctl ssh console`, run `which yt-dlp`
3. **YouTube blocking datacenter IP** → Cookies should help, but may need residential proxies

**Fallback Plan:**
If YouTube still blocks Fly.io's datacenter IPs even with cookies:
- Consider using a residential proxy service ($50-100/mo)
- Or implement a hybrid with a self-hosted solution on a residential IP

---

## 💰 Cost

**Monthly:**
- Hosting: $0 (already paying for Fly.io)
- Cookie API: $0 (free service)
- yt-dlp: $0 (open source)
- **Total: $0/mo**

**Hidden Costs:**
- Potential reliability issues if YouTube blocking gets aggressive
- Cookie API may go offline (fallback to manual cookie export)

**vs RapidAPI:**
- RapidAPI would be $50/mo but URLs are broken (404)
- So yt-dlp is the only viable option

---

## 📋 Deployment Checklist

- [x] Updated Dockerfile to include yt-dlp
- [x] Built realtime server successfully
- [ ] Deploy to Fly.io
- [ ] Verify yt-dlp binary exists in container
- [ ] Test YouTube search
- [ ] Test YouTube streaming
- [ ] Test full track playback in app
- [ ] Verify BPM detection works
- [ ] Monitor for errors

---

## 🐛 Debugging Commands

```bash
# SSH into production container
flyctl ssh console --app puidboard-realtime

# Check if yt-dlp is installed
which yt-dlp
yt-dlp --version

# Check cookie file
ls -la /app/.storage/
cat /app/.storage/youtube-cookies.txt | head -5

# Test yt-dlp directly
yt-dlp --cookies /app/.storage/youtube-cookies.txt \
  --dump-json "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  | jq '.formats[] | select(.acodec != "none" and .vcodec == "none") | {format_id, ext, url}'
```

---

**Status:** Ready to deploy
**Confidence:** 85% (works locally with yt-dlp, cookies help with datacenter IPs)
**Time to deploy:** 5-10 minutes
