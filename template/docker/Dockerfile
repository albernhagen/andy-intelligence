# Starter image for a `cloud-run` project (andy-intelligence baseline seed, AI-401). Seeded once:
# it is this project's own file now, so change it freely; the baseline never rewrites it.
# Builds the app with pnpm and serves dist/main.js on $PORT (Cloud Run sets it; 8080 by default),
# with /health answering 200 for the deploy smoke check and the uptime check (infra/ project-env).
# Base image pinned tag@digest (the multi-arch index; both stages the same). Dependabot's monthly
# docker group moves the digest; the Node major moves with .nvmrc by hand.
FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:24-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The image's built-in non-root user; files stay root-owned, so the app cannot rewrite itself.
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.js"]
