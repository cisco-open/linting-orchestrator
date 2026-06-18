# syntax=docker/dockerfile:1
#
# Linting Orchestrator
#
# Multi-stage build for the monorepo.  The same image is used to run
# both spectifyd (orchestrator, port 3003) and spectifyr (reports, port 3010).
# Which service starts is determined by the `command:` in docker-compose.yml.
#
# Quick start:
#   docker compose up -d
#
# Build the image manually:
#   docker build -t spectify:latest .

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: builder
#
# Installs all dependencies, compiles TypeScript, installs vendored ruleset
# npm deps, then strips dev dependencies so the runtime layer stays lean.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# better-sqlite3 is a native addon — needs a C++ toolchain at npm install time.
# bash is required by the install-rulesets helper script.
RUN apk add --no-cache python3 make g++ bash

WORKDIR /app

# ── Step 1: workspace manifests only (maximise layer-cache reuse) ─────────────
# These layers are only invalidated when package*.json files change.
COPY package.json package-lock.json                    ./
COPY packages/document-store/package.json              ./packages/document-store/
COPY packages/reports/package.json                     ./packages/reports/
COPY packages/orchestrator/package.json                ./packages/orchestrator/

# Skip the postinstall hook (install-rulesets) — the rulesets/sources tree
# is not present yet.  We run it manually in Step 3 below.
RUN npm ci --ignore-scripts

# ── Step 2: source code, assets, and vendored ruleset sources ─────────────────
COPY packages/ ./packages/

# ── Step 3: install npm deps declared inside each vendored ruleset source ──────
# This runs `npm install` in every rulesets/sources/**/package.json directory.
# It does NOT clone anything — only installs locally present sources.
RUN npm run install-rulesets

# ── Step 4: compile all three packages in topological order ───────────────────
#   document-store → reports → orchestrator
RUN npm run build

# ── Step 5: strip dev dependencies ────────────────────────────────────────────
RUN npm prune --omit=dev

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime
#
# Minimal Alpine image — no source files, no build toolchain, non-root user.
# Contains only the compiled JS, production node_modules, and ruleset files.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN addgroup -S spectify && adduser -S spectify -G spectify

WORKDIR /app

# ── Workspace root manifest (needed for npm workspaces path resolution) ────────
COPY --from=builder --chown=spectify:spectify /app/package.json          ./

# ── document-store (library; no binary) ───────────────────────────────────────
COPY --from=builder --chown=spectify:spectify /app/packages/document-store/package.json  ./packages/document-store/
COPY --from=builder --chown=spectify:spectify /app/packages/document-store/build/        ./packages/document-store/build/
COPY --from=builder --chown=spectify:spectify /app/packages/document-store/node_modules/ ./packages/document-store/node_modules/

# ── reports service (spectifyr) ───────────────────────────────────────────────
COPY --from=builder --chown=spectify:spectify /app/packages/reports/package.json    ./packages/reports/
COPY --from=builder --chown=spectify:spectify /app/packages/reports/build/          ./packages/reports/build/
COPY --from=builder --chown=spectify:spectify /app/packages/reports/node_modules/   ./packages/reports/node_modules/

# ── orchestrator daemon + CLI (spectifyd + spectify) ──────────────────────────
COPY --from=builder --chown=spectify:spectify /app/packages/orchestrator/package.json    ./packages/orchestrator/
COPY --from=builder --chown=spectify:spectify /app/packages/orchestrator/build/          ./packages/orchestrator/build/
COPY --from=builder --chown=spectify:spectify /app/packages/orchestrator/rulesets/       ./packages/orchestrator/rulesets/
COPY --from=builder --chown=spectify:spectify /app/packages/orchestrator/node_modules/   ./packages/orchestrator/node_modules/

# ── Shared root node_modules (workspace-hoisted deps + @cisco-open/* symlinks) ─
COPY --from=builder --chown=spectify:spectify /app/node_modules/ ./node_modules/

# Runtime data directory.
# Mount a named volume or bind mount here, or override with SPECTIFY_HOME.
RUN mkdir -p /data/spectify && chown spectify:spectify /data/spectify

ENV SPECTIFY_HOME=/data/spectify \
    NODE_ENV=production

VOLUME ["/data/spectify"]

# 3003 = spectifyd (orchestrator daemon)
# 3010 = spectifyr (reports service)
EXPOSE 3003 3010

USER spectify

# Default: run the orchestrator daemon.
# Override via `command:` in docker-compose.yml to run spectifyr instead.
CMD ["node", "packages/orchestrator/build/index.js"]
