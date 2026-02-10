# How to Get YouTube Cookies for play-dl

## Method 1: Using Browser Extension (Easiest)

1. **Install "Get cookies.txt LOCALLY" extension**
   - Chrome/Edge: https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc
   - Firefox: https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/

2. **Go to YouTube.com** (make sure you're logged in)

3. **Click the extension icon** and click "Export"

4. **Copy the cookie string** - it will look like:
   ```
   # Netscape HTTP Cookie File
   .youtube.com	TRUE	/	TRUE	1234567890	CONSENT	YES+...
   .youtube.com	TRUE	/	FALSE	1234567890	VISITOR_INFO1_LIVE	abc123...
   ```

## Method 2: Using Browser DevTools

1. **Open YouTube.com** (logged in)
2. **Press F12** to open DevTools
3. **Go to Application tab** → Cookies → https://www.youtube.com
4. **Copy these specific cookies into a string format:**
   - Find `VISITOR_INFO1_LIVE` and copy its value
   - Find `CONSENT` and copy its value
   - Format: `VISITOR_INFO1_LIVE=value1; CONSENT=value2;`

## What to Do With the Cookies

Once you have the cookie string, add it to Fly.io secrets:

```bash
fly secrets set YOUTUBE_COOKIE="your_cookie_string_here" --app puidboard-realtime
```

**Important:** The cookies need to be from a logged-in YouTube session to avoid bot detection.

## Testing Locally

Create a `.env.local` file in `apps/realtime/`:

```bash
YOUTUBE_COOKIE="your_cookie_string_here"
```

Then test:
```bash
cd apps/realtime
pnpm dev
```

Try searching for something in your app - it should work!
