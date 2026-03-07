# Dockerfile for puidboard-realtime
# Build from monorepo root: docker build -f apps/realtime/Dockerfile .

FROM node:20-alpine AS base
RUN apk add --no-cache python3 ffmpeg yt-dlp
RUN corepack enable && corepack prepare pnpm@9 --activate

# Production dependencies only
FROM base AS deps
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/realtime/package.json ./apps/realtime/

RUN pnpm install --frozen-lockfile --prod

# Build stage
FROM base AS builder
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY apps/realtime ./apps/realtime
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile

# Build shared package
WORKDIR /app/packages/shared
RUN pnpm build

# Build realtime server
WORKDIR /app/apps/realtime
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/realtime/node_modules ./apps/realtime/node_modules

# Copy package.json files for module resolution
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/realtime/package.json ./apps/realtime/

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/realtime/dist ./apps/realtime/dist

# Create storage directory for tracks and YouTube cookies
RUN mkdir -p /app/apps/realtime/.storage/tracks
RUN mkdir -p /app/.storage

WORKDIR /app/apps/realtime

EXPOSE 3001

CMD ["node", "--max-old-space-size=1800", "dist/server.js"]
