# Deployment Setup Guide

This guide covers deploying puidBoard to production using Fly.io, Vercel, Supabase, and Upstash Redis.

## Services Overview

| Service | Purpose | URL |
|---------|---------|-----|
| **Fly.io** | Backend WebSocket server | https://puidboard-realtime.fly.dev |
| **Vercel** | Frontend Next.js app | https://puidboard.com |
| **Upstash Redis** | Room state caching + pubsub | (managed by Upstash) |
| **Supabase** | File storage for audio tracks | (managed by Supabase) |

## Quick Start Checklist

1. [ ] Create Supabase project and storage bucket
2. [ ] Create Upstash Redis database
3. [ ] Set Fly.io secrets for realtime server
4. [ ] Deploy realtime server to Fly.io
5. [ ] Set Vercel environment variables
6. [ ] Deploy frontend to Vercel
7. [ ] Update CORS origins on Fly.io

---

## 1. Supabase Setup (File Storage)

Supabase provides persistent storage for audio track files. Local filesystem storage won't work on Fly.io (ephemeral).

### Create Project
1. Go to https://supabase.com/dashboard
2. Create new project (e.g., "puidboard")
3. Note down:
   - **Project URL**: `https://your-project.supabase.co`
   - **Service Role Key**: Found in Settings > API > service_role (secret)

### Create Storage Bucket
1. Go to Storage in Supabase dashboard
2. Create new bucket named `tracks`
3. Set bucket to **public** for audio streaming
4. Configure CORS policy:
   ```json
   {
     "allowedOrigins": ["https://puidboard.com", "https://www.puidboard.com", "http://localhost:3000"],
     "allowedMethods": ["GET", "HEAD"],
     "allowedHeaders": ["*"],
     "maxAgeSeconds": 3600
   }
   ```

---

## 2. Upstash Redis Setup (Optional)

Redis provides room state persistence across server restarts. Without Redis, room state is stored in memory and lost on restart.

### Create Database
1. Go to https://console.upstash.com
2. Create new Redis database
3. Select region closest to Fly.io region (e.g., us-east-1 for iad)
4. Copy the **Redis URL** (starts with `redis://` or `rediss://`)

---

## 3. Backend Deployment (Fly.io)

### First-Time Setup
```bash
# Install Fly CLI
brew install flyctl

# Login to Fly
fly auth login

# Navigate to realtime app
cd apps/realtime

# Create app (already done if app exists)
fly apps create puidboard-realtime
```

### Set Secrets
```bash
# REQUIRED: CORS origins for your frontend domain
fly secrets set CORS_ORIGINS="https://puidboard.com,https://www.puidboard.com"

# REQUIRED: Supabase storage (for audio files)
fly secrets set SUPABASE_URL="https://your-project.supabase.co"
fly secrets set SUPABASE_SERVICE_KEY="eyJhbGciOi..."

# OPTIONAL: Redis for state persistence
fly secrets set REDIS_URL="redis://default:password@your-redis.upstash.io:6379"
```

### Deploy
```bash
# From monorepo root
cd /Users/ibbybajwa/puidBoard

# Build the realtime server
pnpm build --filter=@puid-board/realtime...

# Deploy to Fly.io
fly deploy --app puidboard-realtime -c apps/realtime/fly.toml
```

### Verify Deployment
```bash
# Check health endpoint
curl https://puidboard-realtime.fly.dev/health

# View logs
fly logs --app puidboard-realtime
```

---

## 4. Frontend Deployment (Vercel)

### Import Project
1. Go to https://vercel.com/new
2. Import your GitHub repository
3. Configure project settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/web`
   - **Build Command**: `cd ../.. && pnpm install && pnpm build --filter=@puid-board/web`
   - **Output Directory**: `.next`

### Set Environment Variables
In Vercel dashboard > Settings > Environment Variables:

```bash
# Required: URL of your Fly.io realtime server
NEXT_PUBLIC_REALTIME_URL=https://puidboard-realtime.fly.dev

# Optional: Supabase for future features
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### Custom Domain
1. Go to Settings > Domains
2. Add your custom domain (e.g., puidboard.com)
3. Update DNS records as instructed by Vercel

---

## 5. Post-Deployment: Update CORS

After deploying the frontend to its final domain, update the CORS origins on Fly.io:

```bash
fly secrets set CORS_ORIGINS="https://puidboard.com,https://www.puidboard.com" --app puidboard-realtime
```

---

## Environment Variables Reference

### Backend (Fly.io) - apps/realtime

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `PORT` | No | Server port (default: 3001) | `3001` |
| `NODE_ENV` | No | Environment (default: production) | `production` |
| `CORS_ORIGINS` | **Yes** | Comma-separated allowed origins | `https://puidboard.com` |
| `SUPABASE_URL` | **Yes** | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | **Yes** | Supabase service role key | `eyJhbGciOi...` |
| `REDIS_URL` | No | Upstash Redis connection URL | `redis://...` |

### Frontend (Vercel) - apps/web

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_REALTIME_URL` | **Yes** | Fly.io realtime server URL | `https://puidboard-realtime.fly.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | No | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Supabase anon/public key | `eyJhbGciOi...` |

---

## Troubleshooting

### CORS Errors
**Symptom**: Browser console shows `Access-Control-Allow-Origin` errors.

**Solution**:
1. Check that `CORS_ORIGINS` includes your frontend domain
2. Make sure there are no trailing slashes in origins
3. Include both `https://domain.com` and `https://www.domain.com` if used
4. Restart the Fly.io app after changing secrets: `fly apps restart puidboard-realtime`

### WebSocket Connection Failed
**Symptom**: Cannot connect to realtime server.

**Solution**:
1. Verify `NEXT_PUBLIC_REALTIME_URL` is set correctly in Vercel
2. Check Fly.io app is running: `fly status --app puidboard-realtime`
3. Check logs for errors: `fly logs --app puidboard-realtime`

### Audio Files Not Loading
**Symptom**: Tracks upload but audio doesn't play.

**Solution**:
1. Verify Supabase storage bucket `tracks` exists and is public
2. Check `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set on Fly.io
3. Verify CORS policy on Supabase storage bucket allows your frontend domain

### Room State Lost on Restart
**Symptom**: Rooms disappear when server restarts.

**Solution**: Configure Redis for persistence:
```bash
fly secrets set REDIS_URL="redis://..." --app puidboard-realtime
```

---

## Local Development

### Backend (Realtime Server)
```bash
cd apps/realtime
cp .env.example .env
# Edit .env with local settings

pnpm dev
```

### Frontend (Web App)
```bash
cd apps/web
# .env.local should already have localhost settings

pnpm dev
```

Both should now be running:
- Frontend: http://localhost:3000
- Realtime: http://localhost:3001

---

## Architecture

```
                    ┌─────────────────┐
                    │     Vercel      │
                    │   (Frontend)    │
                    │  puidboard.com  │
                    └────────┬────────┘
                             │
                             │ WebSocket + HTTP
                             │
                    ┌────────▼────────┐
                    │     Fly.io      │
                    │   (Realtime)    │
                    │ *.fly.dev:3001  │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼───────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │    Upstash    │ │  Supabase   │ │  Supabase   │
    │    Redis      │ │   Storage   │ │  (Future)   │
    │ (Room State)  │ │   (Audio)   │ │  Postgres   │
    └───────────────┘ └─────────────┘ └─────────────┘
```
