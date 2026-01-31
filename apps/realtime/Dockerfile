# Dockerfile for puidboard-realtime
# Build artifacts locally first with: pnpm build --filter=@puid-board/realtime...
# Then build from monorepo root: docker build -f apps/realtime/Dockerfile .

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate

# Production dependencies only
FROM base AS deps
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/realtime/package.json ./apps/realtime/

RUN pnpm install --frozen-lockfile --prod

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

# Copy pre-built artifacts (must build locally first!)
COPY packages/shared/dist ./packages/shared/dist
COPY apps/realtime/dist ./apps/realtime/dist

# Create storage directory
RUN mkdir -p /app/apps/realtime/.storage/tracks

WORKDIR /app/apps/realtime

EXPOSE 3001

CMD ["node", "dist/server.js"]
