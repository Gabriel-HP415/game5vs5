# ---- build stage ----
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /repo

# Copy workspace manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/game-server/package.json apps/game-server/

# Install workspace deps (npm workspaces hoists by default)
RUN npm install --no-audit --no-fund

# Copy sources
COPY tsconfig.base.json* ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Build shared (required for type-aware builds) then web
RUN npm run build -w @rift/shared \
 && npm run build -w @rift/web

# ---- runtime stage ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]