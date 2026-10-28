# Control-plane image: API (bundled) + built SPA, served by one Cloud Run service.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @andy/api --filter @andy/web build
# Production-only node_modules for the API.
RUN pnpm --filter @andy/api deploy --prod --legacy /out

FROM node:24-slim
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
