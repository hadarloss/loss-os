# Multi-stage build for the Next.js dashboard (App Router, output: "standalone").
#
# Note: `skills/`, `context/`, and `outputs/` are read at runtime via fs (not
# imported as JS modules), so Next's standalone output tracing does NOT pick
# them up automatically — they're copied explicitly below. `context/` and
# `outputs/` are also bind-mounted by docker-compose.yml so writes made while
# the app is running (business profile edits, memory log entries, saved
# outputs) persist across container restarts/rebuilds instead of being lost.
# The real data files (BUSINESS_PROFILE.md, MEMORY_LOG.md, saved outputs) are
# gitignored — only the *.template.md files and outputs/**/.gitkeep are
# tracked, so `git pull` + redeploy can never overwrite live data with
# whatever's in the repo (lib/fs/paths.ts seeds the real file from the
# template only if it doesn't already exist).

FROM node:26-alpine AS deps
WORKDIR /app
# better-sqlite3 is a native module built via node-gyp at install time — needs
# a C++ toolchain + Python, which the base alpine image doesn't ship with.
# These are only needed in this (discarded) build stage, not the final image.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs skills ./skills
COPY --chown=nextjs:nodejs context ./context
COPY --chown=nextjs:nodejs outputs ./outputs

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
