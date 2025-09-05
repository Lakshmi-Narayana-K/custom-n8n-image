# =========================
# Custom n8n (build from source, ready for GH Actions)
# =========================
ARG NODE_VERSION=22

# ---------- builder ----------
# Use upstream base that already has fonts, tini, tzdata, ICU, etc.
FROM n8nio/base:${NODE_VERSION} AS builder

# Helpful for memory-constrained build environments
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max_old_space_size=2048"

# Extra system deps used in upstream build
USER root
RUN apk add --no-cache libc6-compat jq git openssh

USER node
WORKDIR /home/node

# Copy monorepo (keep this order to maximize layer cache)
COPY --chown=node:node turbo.json package.json pnpm-lock.yaml .npmrc* ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node packages ./packages
COPY --chown=node:node patches ./patches

# Enable pnpm via corepack (same pattern as upstream)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install deps and build
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Slim to production deps
RUN rm -rf node_modules \
  && jq 'del(.pnpm.patchedDependencies)' package.json > package.tmp.json && mv package.tmp.json package.json \
  && jq '{name: .name, version: .version}' packages/editor-ui/package.json > packages/editor-ui/package.json.tmp && mv packages/editor-ui/package.json.tmp packages/editor-ui/package.json \
  && jq '{name: .name, version: .version}' packages/cli/package.json > packages/cli/package.json.tmp && mv packages/cli/package.json.tmp packages/cli/package.json \
  && pnpm install --prod --no-optional \
  && find . -type f -name "*.ts" -o -name "*.js.map" -delete \
  && rm -rf patches .npmrc *.yaml node_modules/.cache

# ---- customization hooks (copy your overrides here) ----
# Example: add custom nodes or branding assets (uncomment & adjust paths)
# COPY --chown=node:node docker/images/n8n-custom/custom-nodes/ packages/nodes-base/nodes/custom/
# COPY --chown=node:node docker/images/n8n-custom/branding/ packages/editor-ui/src/public/

# ---------- runner ----------
# Use the same base runtime as your existing images (alpine + tini + ICU)
FROM node:${NODE_VERSION}-alpine AS runtime

# parity with docker/images/n8n-base/Dockerfile (fonts & tools come from base image there)
RUN apk add --no-cache bash tini jq tzdata ca-certificates libc6-compat

ENV NODE_ENV=production \
  NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu \
  N8N_PORT=5678 \
  N8N_HOST=0.0.0.0 \
  N8N_LOG_LEVEL=info \
  N8N_DIAGNOSTICS_ENABLED=false

WORKDIR /home/node
USER node

# Copy built workspace to runtime
COPY --from=builder --chown=node:node /home/node /usr/local/lib/node_modules/n8n

# Link CLI entry
USER root
RUN ln -s /usr/local/lib/node_modules/n8n/packages/cli/bin/n8n /usr/local/bin/n8n \
  && mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n
USER node

# Entry + port
COPY --chown=node:node docker/images/n8n-custom/docker-entrypoint.sh /docker-entrypoint.sh
EXPOSE 5678

ENTRYPOINT ["tini","--","/docker-entrypoint.sh"]
CMD ["n8n","start"]
