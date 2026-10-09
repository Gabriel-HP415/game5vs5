# ---- deps stage ----
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/game-server/package.json apps/game-server/

# Install all workspace deps; npm workspaces hoist by default
RUN npm install --no-audit --no-fund

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /repo

COPY tsconfig.base.json* ./
COPY package.json package-lock.json* ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
COPY apps/game-server/ apps/game-server/
COPY --from=deps /repo/node_modules /repo/node_modules

RUN npm run build -w @rift/shared \
 && npm run build -w @rift/server

# ---- runtime stage ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=2567
WORKDIR /app

# Bring in the full monorepo so workspace symlinks (@rift/shared) still resolve
COPY --from=build /repo /repo
WORKDIR /repo

# Re-install a slim prod-only tree while keeping workspace symlinks
RUN npm prune --omit=dev --no-audit --no-fund \
 && npm install --no-save tsx@4.19.1 --no-audit --no-fund

EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:2567/health || exit 1

# tsx loads TS from @rift/shared and runs the compiled server entry
CMD ["sh", "-c", "cd /repo/apps/game-server && exec npx --no-install tsx src/index.ts"]