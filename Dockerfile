# Control-plane image: API (bundled) + built SPA, served by one Cloud Run service.
# Base image pinned tag@digest (both stages the same); Dependabot's docker updates move both (AI-399).
FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @andy/api --filter @andy/web build
# Production-only node_modules for the API.
RUN pnpm --filter @andy/api deploy --prod --legacy /out

FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
ENV NODE_ENV=production \
    WEB_ROOT=/app/public
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./public
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.js"]
