# Deployment Setup Guide

## Services Overview

| Service | Purpose | URL |
|---------|---------|-----|
| **Fly.io** | Backend WebSocket server | https://puidboard-realtime.fly.dev |
| **Vercel** | Frontend Next.js app | TBD |
| **Upstash Redis** | Room state caching + pubsub | TBD |
| **Supabase** | Postgres DB + File storage | TBD |

## Environment Variables Needed

### Backend (Fly.io) - apps/realtime
```bash
PORT=3001
NODE_ENV=production
CORS_ORIGINS=https://your-vercel-app.vercel.app
REDIS_URL=redis://default:password@endpoint:port

# Optional - for future Postgres features
DATABASE_URL=postgresql://...
```

### Frontend (Vercel) - apps/web
```bash
NEXT_PUBLIC_REALTIME_URL=https://puidboard-realtime.fly.dev

# Optional - for future Supabase features
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx...
```

## Deployment Commands

### Backend (Already Deployed ✅)
```bash
cd /Users/ibbybajwa/puidBoard
pnpm build --filter=@puid-board/realtime...
flyctl deploy --app puidboard-realtime
```

### Frontend (Manual Vercel Dashboard Setup)
1. Go to https://vercel.com/new
2. Import `ahmadsk7/puidBoard` repo
3. Configure:
   - Root Directory: `apps/web`
   - Build Command: `cd ../.. && pnpm install && pnpm build --filter=@puid-board/web`
   - Install Command: Default
   - Output Directory: `.next`
4. Add env var: `NEXT_PUBLIC_REALTIME_URL`
5. Deploy

## Current Status

- [x] Backend deployed to Fly.io
- [x] Backend health check working
- [ ] Frontend deployed to Vercel
- [ ] Redis configured
- [ ] Supabase project created
- [ ] CORS updated with frontend URL
