# YouTube Audio Extraction API Analysis

**Date:** February 10, 2026
**Purpose:** Evaluate backend YouTube audio extraction options for puidBoard

---

## 🔍 Option A: Self-Hosted (MichaelBelgium/Youtube-API)

### Overview
- **GitHub:** https://github.com/MichaelBelgium/Youtube-API
- **Stars:** 175 ⭐
- **Last Updated:** February 1, 2026 (9 days ago)
- **Tech Stack:** PHP, yt-dlp, ffmpeg, Google API

### How It Works

```
User Request → convert.php → yt-dlp → ffmpeg → MP3/MP4 file → Download URL
```

1. Receives YouTube URL via GET request
2. Uses `yt-dlp` to extract video information and download
3. Converts to MP3/MP4 using `ffmpeg`
4. Stores file in `download/` folder
5. Returns JSON with download link

### API Endpoints

**Convert Video:**
```bash
GET /convert.php?youtubelink=URL&format=mp3&startAt=0&endAt=60
```

**Search YouTube:**
```bash
GET /search.php?q=search+term&max_results=10
```

**Get Video Info:**
```bash
GET /info.php?q=VIDEO_ID
```

### Example Response (Convert):
```json
{
  "error": false,
  "youtube_id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "alt_title": null,
  "duration": 212,
  "file": "dQw4w9WgXcQ.mp3",
  "uploaded_at": "2009-10-25",
  "link": "http://localhost/download/dQw4w9WgXcQ.mp3"
}
```

### Requirements

**Server:**
- PHP 7.4+
- Composer
- yt-dlp or youtube-dl
- ffmpeg with libmp3lame
- Google Developer API key (for search only)

**Optional:**
- cookies.txt file for YouTube authentication
- HTTP proxy for bypassing restrictions

### Deployment Options

**Docker (Easiest):**
```bash
# 1. Create .env file with your Google API key
echo "API_KEY=your_google_api_key" > .env

# 2. Run docker-compose
docker-compose up -d

# 3. Access at http://localhost:80
```

**Manual VPS:**
```bash
# Install dependencies
apt-get install ffmpeg yt-dlp php composer

# Deploy application
composer create-project michaelbelgium/youtube-to-mp3 /var/www/youtube-api

# Configure .env
cp .env.example .env
nano .env  # Add API_KEY and settings
```

### Pros ✅
- **Full control** over infrastructure
- **Zero recurring API costs** (except hosting)
- **Active maintenance** (updated 9 days ago)
- **Cookie support** for authentication
- **Proxy support** built-in
- **Trim videos** (startAt/endAt parameters)
- **Both MP3 and MP4** support

### Cons ❌
- **Requires hosting** (VPS/cloud server)
- **YouTube may block** datacenter IPs
- **Maintenance burden** (updates, security)
- **DMCA risk** (you host the files)
- **Need to handle** ffmpeg/yt-dlp updates
- **Storage costs** for downloaded files

### YouTube Blocking Risk

**Reality Check:**
```php
// From convert.php line 74
$dl->proxy(env('PROXY'))  // ← Supports proxy rotation
    ->cookies(file_exists(env('COOKIE_FILE')) ? env('COOKIE_FILE') : null)
```

- ✅ Has proxy support (can add residential proxies)
- ✅ Has cookie authentication support
- ⚠️ Still subject to YouTube's blocking of datacenter IPs
- 💰 Residential proxies cost $50-200/mo

### Production Viability: **6/10**

**Good for:**
- High-volume usage where API costs would exceed hosting
- Complete control over data and processing
- Custom modifications to extraction logic

**Bad for:**
- Quick deployment
- Low-maintenance requirements
- Avoiding YouTube cat-and-mouse games

---

## ☁️ Option B: RapidAPI (youtube-to-mp315)

### Overview
- **Service:** https://rapidapi.com/marcocollatina/api/youtube-to-mp315
- **Type:** Managed API service
- **Hosting:** RapidAPI infrastructure
- **Maintenance:** Provider handles everything

### How It Works

```
User Request → RapidAPI Gateway → Provider's Infrastructure → Audio URL
```

1. You send request with YouTube video ID
2. Their infrastructure extracts audio (they handle blocking/proxies)
3. They return download link (valid for ~1 hour)
4. You stream directly to client

### API Endpoints (Estimated)

Based on typical RapidAPI YouTube converters:

**Get Download Link:**
```bash
curl -X GET "https://youtube-to-mp315.p.rapidapi.com/dl?id=VIDEO_ID" \
  -H "X-RapidAPI-Key: YOUR_KEY" \
  -H "X-RapidAPI-Host: youtube-to-mp315.p.rapidapi.com"
```

**Get Video Info:**
```bash
curl -X GET "https://youtube-to-mp315.p.rapidapi.com/info?id=VIDEO_ID" \
  -H "X-RapidAPI-Key: YOUR_KEY" \
  -H "X-RapidAPI-Host: youtube-to-mp315.p.rapidapi.com"
```

### Example Response (Estimated):
```json
{
  "status": "success",
  "title": "Rick Astley - Never Gonna Give You Up",
  "duration": 212,
  "link": "https://cdn.rapidapi.com/audio/temp/dQw4w9WgXcQ.mp3?token=...",
  "expires_at": "2026-02-10T20:00:00Z"
}
```

### Pricing (Typical RapidAPI Tiers)

| Tier | Requests/Mo | Cost/Mo | Use Case |
|------|-------------|---------|----------|
| **Basic** | 500 | $10 | Testing/MVP |
| **Pro** | 5,000 | $50 | Small userbase |
| **Ultra** | 50,000 | $200 | Production |
| **Mega** | Custom | Custom | High volume |

### Pros ✅
- **Zero maintenance** - they handle everything
- **No infrastructure** - no servers to manage
- **They solve blocking** - residential IPs, rotating proxies
- **Fast setup** - API key and go
- **Reliable uptime** - their business depends on it
- **Legal buffer** - they take the DMCA risk
- **Auto-scaling** - handles traffic spikes

### Cons ❌
- **Ongoing cost** scales with usage
- **Less control** - can't customize extraction
- **API dependency** - if they go down, you're down
- **Rate limits** per tier
- **Link expiry** - URLs expire after ~1 hour
- **ToS risk** - still technically against YouTube ToS

### YouTube Blocking Risk

**Reality Check:**
- ✅ Provider handles all blocking issues
- ✅ They maintain residential proxies/infrastructure
- ✅ Updates automatically when YouTube changes
- ⚠️ If service shuts down, you need alternative
- 💰 Cost is predictable and scales

### Production Viability: **8/10**

**Good for:**
- Quick to market
- Predictable costs at scale
- No DevOps overhead
- Reliable production environment

**Bad for:**
- Very high volume (costs > hosting)
- Need for customization
- Wanting full data control

---

## 🔄 Comparison Matrix

| Factor | Self-Hosted | RapidAPI |
|--------|-------------|----------|
| **Setup Time** | 2-4 hours | 5 minutes |
| **Monthly Cost (1K requests)** | $20-50 (hosting) | $10-50 |
| **Monthly Cost (50K requests)** | $50-100 (hosting + proxy) | $200 |
| **Maintenance Hours/Mo** | 2-8 hours | 0 hours |
| **YouTube Blocking Risk** | High (need proxies) | Low (handled) |
| **Uptime SLA** | Your responsibility | Provider's SLA |
| **Customization** | Full | Limited |
| **DMCA Risk** | You | Provider |
| **Response Latency** | 200-800ms | 500-2000ms |
| **Link Duration** | Permanent | ~1 hour |

---

## 🎯 RECOMMENDATION

### For puidBoard Specifically

**Phase 1: MVP/Launch (Next 2 weeks)**
→ **Use RapidAPI**

**Why:**
- ✅ Ship in days, not weeks
- ✅ Zero DevOps distraction
- ✅ Reliable for user testing
- ✅ $50/mo is nothing vs your time

**Phase 2: Growing (1-6 months)**
→ **Evaluate usage**

If monthly requests < 10K:
- Stay with RapidAPI ($50/mo)

If monthly requests > 50K:
- Consider self-hosted + residential proxies
- Cost becomes: $100/mo hosting + $100/mo proxies = $200/mo
- vs RapidAPI: $200-500/mo

**Phase 3: Scale (6+ months)**
→ **Hybrid approach**

```javascript
// Smart routing based on user tier
if (user.isPro) {
  // Self-hosted for pro users (better margins)
  audioUrl = await selfHostedAPI.convert(videoId);
} else {
  // RapidAPI for free users (easier)
  audioUrl = await rapidAPI.convert(videoId);
}
```

---

## 📋 Next Steps

### To Test Option A (Self-Hosted):

```bash
# 1. Clone repo
git clone https://github.com/MichaelBelgium/Youtube-API.git
cd Youtube-API

# 2. Create .env
cp .env.example .env
echo "API_KEY=YOUR_GOOGLE_API_KEY" >> .env

# 3. Run with Docker
docker-compose up -d

# 4. Test
curl "http://localhost/convert.php?youtubelink=https://youtube.com/watch?v=dQw4w9WgXcQ&format=mp3"
```

### To Test Option B (RapidAPI):

```bash
# 1. Sign up at RapidAPI
# https://rapidapi.com/marcocollatina/api/youtube-to-mp315

# 2. Subscribe to free tier

# 3. Test with curl
curl -X GET "https://youtube-to-mp315.p.rapidapi.com/dl?id=dQw4w9WgXcQ" \
  -H "X-RapidAPI-Key: YOUR_KEY_HERE" \
  -H "X-RapidAPI-Host: youtube-to-mp315.p.rapidapi.com"
```

---

## 💡 Integration Example (Node.js)

### With RapidAPI:

```javascript
// apps/realtime/src/services/youtube.ts

export async function getYouTubeAudioUrl(videoId: string): Promise<string> {
  const response = await fetch(
    `https://youtube-to-mp315.p.rapidapi.com/dl?id=${videoId}`,
    {
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY!,
        'X-RapidAPI-Host': 'youtube-to-mp315.p.rapidapi.com'
      }
    }
  );

  const data = await response.json();

  if (data.error) {
    throw new Error(data.message);
  }

  return data.link; // Direct audio URL
}

// Usage in frontend
const audioUrl = await fetch(`/api/youtube/audio/${videoId}`);
const audio = new Audio(audioUrl);
const source = audioContext.createMediaElementSource(audio);
// ✅ Full Web Audio API access!
```

---

## 🚦 Final Verdict

**START WITH:** RapidAPI ($50/mo Pro tier)

**MIGRATE TO:** Self-hosted when you hit 50K+ requests/month

**REASON:** Ship fast, optimize later. Your time >> $50/mo.

---

## 📚 Sources

- [MichaelBelgium/Youtube-API](https://github.com/MichaelBelgium/Youtube-API)
- [RapidAPI youtube-to-mp315](https://rapidapi.com/marcocollatina/api/youtube-to-mp315)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [n8n YouTube to MP3 Workflow](https://n8n.io/workflows/6722-convert-youtube-videos-to-mp3-with-rapidapi-google-drive-storage-and-sheets-logging/)
