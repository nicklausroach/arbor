# Single-image build of Arbor for ephemeral Fly PR preview apps: builds the web SPA and
# the server, then serves both from the one Node process (see ARBOR_WEB_DIR wiring in
# server/src/index.ts).

# ---- builder: compile web + server (needs the native-module toolchain) -------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# node-gyp builds better-sqlite3 and node-pty from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Install with the lockfile first for layer caching. The root postinstall chmods the
# node-pty spawn-helper; "|| true" in that script keeps it from failing the build.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY . .
RUN npm run build --workspace server \
    && npm run build --workspace web \
    # tsc does not copy non-TS assets; the runtime reads schema.sql relative to dist.
    && cp server/src/db/schema.sql server/dist/db/schema.sql

# ---- runtime: Node + git + the (unauthenticated) agent CLI -------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# git: Arbor drives `git worktree`. Agent CLI installed but NOT authenticated — preview
# apps exercise the UI/planner/GitHub flow; live agent runs stop at the auth boundary.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/lib/apt/lists/*

# Seed a throwaway git checkout so preview apps have a repository to select in the Connect
# flow (the container otherwise has no project repo on disk). On boot the server inserts a
# repositories row pointing here — see seedPreviewRepo / ARBOR_PREVIEW below. origin points
# at a real sandbox repo you control so the GitHub issue/PR flow works with a PAT; override
# SEED_REMOTE_URL at build time to use a different repo.
ARG SEED_REMOTE_URL=https://github.com/nicklausroach/arbor-sandbox.git
RUN git config --global user.email "preview@arbor.dev" \
    && git config --global user.name "Arbor Preview" \
    && mkdir -p /seed/sample-repo \
    && git -C /seed/sample-repo init -q -b main \
    && printf '# Arbor Sandbox\n\nThrowaway repo for exercising Arbor preview apps.\n' > /seed/sample-repo/README.md \
    && git -C /seed/sample-repo add README.md \
    && git -C /seed/sample-repo commit -q -m "Initial commit" \
    && git -C /seed/sample-repo remote add origin "$SEED_REMOTE_URL"

# Native addons (better-sqlite3, node-pty) match because builder and runtime share the
# same base image, so the compiled node_modules copy over directly. npm workspaces hoist
# all deps to the root node_modules; Node resolves up to it from server/dist.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/package.json ./package.json

# Ephemeral per-preview state (DB, worktrees, secrets file). Lost on app destroy — which
# is exactly what we want for a throwaway PR environment.
ENV ARBOR_HOME=/data \
    ARBOR_DB_PATH=/data/arbor.sqlite \
    ARBOR_WEB_DIR=/app/web/dist \
    ARBOR_PREVIEW=1 \
    ARBOR_SEED_REPO_PATH=/seed/sample-repo \
    PORT=8080
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
