# =========================
# Custom n8n (build from source, CI-friendly)
# =========================
ARG NODE_VERSION=22

# ---------- builder ----------
FROM n8nio/base:${NODE_VERSION} AS builder

ENV NODE_ENV=production
# friendlier RAM usage during builds
ENV NODE_OPTIONS="--max_old_space_size=2048"

# system deps
USER root
RUN apk add --no-cache libc6-compat jq git openssh

WORKDIR /home/node
USER node

# ---- copy root workspace files FIRST (for correct pnpm behavior & caching) ----
# IMPORTANT: pnpm-workspace.yaml carries catalogs used by overrides
COPY --chown=node:node pnpm-workspace.yaml turbo.json package.json pnpm-lock.yaml .npmrc* ./

# rest of the monorepo
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node packages ./packages
COPY --chown=node:node patches ./patches
# (optional but harmless if present)
COPY --chown=node:node tsconfig.base.json tsconfig.json* ./

# enable pnpm via corepack (needs root to write /usr/local/bin)
USER root
RUN corepack enable
# Let corepack honor the version specified in package.json's "packageManager"
# (n8n currently uses pnpm v10; no need to pin manually)
USER node

# install & build
RUN pnpm install --frozen-lockfile
RUN pnpm build

# slim to production deps
RUN rm -rf node_modules \
  && jq 'del(.pnpm.patchedDependencies)' package.json > package.tmp.json && mv package.tmp.json package.json \
  && jq '{name: .name, version: .version}' packages/editor-ui/package.json > packages/editor-ui/package.json.tmp && mv packages/editor-ui/package.json.tmp packages/editor-ui/package.json \
  && jq '{name: .name, version: .version}' packages/cli/package.json > packages/cli/package.json.tmp && mv packages/cli/package.json.tmp packages/cli/package.json \
  && pnpm install --prod --no-optional \
  && find . -type f -name "*.ts" -o -name "*.js.map" -delete \
  && rm -rf patches .npmrc *.yaml node_modules/.cache

# ---- customization hooks (uncomment & point to your files if needed) ----
# COPY --chown=node:node docker/images/n8n-custom/custom-nodes/ packages/nodes-base/nodes/custom/
# COPY --chown=node:node docker/images/n8n-custom/branding/ packages/editor-ui/src/public/

# ---------- runner ----------
FROM node:${NODE_VERSION}-alpine AS runtime

# minimal runtime deps
RUN apk add --no-cache bash tini jq tzdata ca-certificates libc6-compat \
  && npm i -g full-icu@1.5.0

ENV NODE_ENV=production \
  NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu \
  N8N_PORT=5678 \
  N8N_HOST=0.0.0.0 \
  N8N_LOG_LEVEL=info \
  N8N_DIAGNOSTICS_ENABLED=false

WORKDIR /home/node
USER node

# copy built workspace into runtime
COPY --from=builder --chown=node:node /home/node /usr/local/lib/node_modules/n8n

# link CLI and ensure data dir exists/owned
USER root
RUN ln -s /usr/local/lib/node_modules/n8n/packages/cli/bin/n8n /usr/local/bin/n8n \
  && mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n
USER node

# entrypoint + port
COPY --chown=node:node docker/images/n8n-custom/docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 5678

ENTRYPOINT ["tini","--","/docker-entrypoint.sh"]
CMD ["n8n","start"]
