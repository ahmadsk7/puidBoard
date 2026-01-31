# Dockerfile for puidboard-realtime
# Build from monorepo root: docker build -f apps/realtime/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# Install dependencies
FROM base AS deps
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/realtime/package.json ./apps/realtime/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build shared package and realtime server
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/realtime/node_modules ./apps/realtime/node_modules

# Copy source
COPY packages/shared ./packages/shared
COPY apps/realtime ./apps/realtime
COPY tsconfig.base.json ./

# Build shared first, then realtime
WORKDIR /app/packages/shared
RUN pnpm build

WORKDIR /app/apps/realtime
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/realtime/dist ./apps/realtime/dist
COPY --from=builder /app/apps/realtime/package.json ./apps/realtime/

# Copy node_modules (production only would be better but this works)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/realtime/node_modules ./apps/realtime/node_modules

# Copy workspace config for module resolution
COPY pnpm-workspace.yaml package.json ./

WORKDIR /app/apps/realtime

EXPOSE 3001

CMD ["node", "dist/server.js"]
