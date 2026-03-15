# YouTube Cookies Setup for Production

## ✨ NEW: Fully Automated Cookie System (RECOMMENDED)

**No manual cookie export needed!** The backend now automatically fetches fresh YouTube cookies from a free API service.

### How It Works

1. **Automatic Cookie Rotation**: Cookies are fetched from `yt-cookies` API (http://185.158.132.66:1234/golden-cookies/ytc)
2. **6-Hour Refresh**: Cookies auto-refresh every 6 hours
3. **Zero Configuration**: Just deploy and it works!

### Implementation

The system is implemented in `apps/realtime/src/services/youtube-cookies.ts`:
- Fetches cookies from remote API on first YouTube request
- Caches cookies to `/app/.storage/youtube-cookies.txt`
- Auto-refreshes when cookies are older than 6 hours
- Falls back to cached cookies if API is temporarily unavailable

### Deploy & Test

```bash
# From monorepo root
pnpm build --filter=@puid-board/realtime...

cd apps/realtime
flyctl deploy
```

Check logs to verify cookie system:
```bash
flyctl logs --app puidboard-realtime

# You should see:
# [YouTube Cookies] Fetching fresh cookies from API...
# [YouTube Cookies] ✓ Fresh cookies written to /app/.storage/youtube-cookies.txt
# [YouTube] Using cookies from: /app/.storage/youtube-cookies.txt
```

---

## Alternative: Manual Cookie Export (Fallback)

If the automated API service is down, you can still manually provide cookies.

### Option 1: Using yt-dlp's Built-in Cookie Extractor (No Extensions!)

On your **local machine** with Chrome/Firefox installed:

```bash
# Install yt-dlp locally (if not already installed)
brew install yt-dlp   # macOS
# or: pip install yt-dlp

# Extract cookies directly from your browser (NO EXTENSION NEEDED!)
yt-dlp --cookies-from-browser chrome --cookies youtube-cookies.txt https://www.youtube.com/watch?v=dQw4w9WgXcQ

# This creates youtube-cookies.txt with your browser's YouTube cookies
```

Supported browsers: `chrome`, `firefox`, `edge`, `safari`, `brave`, `opera`, `vivaldi`

**Note**: Close your browser before running this command to avoid permission errors.

### Option 2: Browser Extensions (If Above Doesn't Work)

1. **Install extension**:
   - Chrome: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
   - Firefox: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)

2. **Export cookies**:
   - Go to youtube.com and log in
   - Click extension icon → Export → Save as `youtube-cookies.txt`
   - Verify first line is: `# Netscape HTTP Cookie File`

### Deploy Manual Cookies to Fly.io

```bash
cd apps/realtime

# Option A: As a Fly.io secret
flyctl secrets set YOUTUBE_COOKIES="$(cat /path/to/youtube-cookies.txt)" --app puidboard-realtime

# Option B: Upload via SSH
flyctl ssh sftp shell --app puidboard-realtime
put /path/to/youtube-cookies.txt /app/.storage/youtube-cookies.txt
exit
```

---

## Troubleshooting

### Error: "Sign in to confirm you're not a bot" still appears

**Automated system**:
- The API service may be temporarily down
- Check logs: `flyctl logs --app puidboard-realtime`
- If API is down, use manual cookie export (see above)

**Manual cookies**:
- Cookies may have expired
- Re-export using `yt-dlp --cookies-from-browser` method
- Make sure you're logged into YouTube when exporting

### Error: "HTTP Error 400: Bad Request"

- Cookie file format is incorrect
- First line must be `# Netscape HTTP Cookie File`
- Use `yt-dlp --cookies-from-browser` method instead of extensions

### Automated API Not Working

Check if API is reachable:
```bash
curl http://185.158.132.66:1234/golden-cookies/ytc
```

If API is down, switch to manual cookie export method above.

---

## Cookie Lifecycle

**Automated System**:
- ✅ Cookies refresh every 6 hours automatically
- ✅ No maintenance required
- ✅ Works as long as the API service is up

**Manual Cookies**:
- ⚠️ Expire after 2-4 weeks
- ⚠️ Require periodic refresh
- Set a calendar reminder to re-export monthly

---

## Sources & References

- [yt-cookies Python Library](https://pypi.org/project/yt-cookies/)
- [yt-dlp FAQ - Passing Cookies](https://github.com/yt-dlp/yt-dlp/wiki/FAQ)
- [yt-dlp Extractors Wiki](https://github.com/yt-dlp/yt-dlp/wiki/Extractors)
- [YouTube Cookie Issues](https://github.com/yt-dlp/yt-dlp/issues/12912)
