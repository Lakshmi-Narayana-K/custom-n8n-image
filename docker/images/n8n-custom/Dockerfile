# Runtime-only custom image that expects ./compiled in the build context
ARG NODE_VERSION=22
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.0
ARG TARGETPLATFORM

# = STAGE 1: Base system (same as your n8n image)
FROM n8nio/base:${NODE_VERSION} AS system-deps

# = STAGE 2: App artifact processor (just receives compiled/)
FROM alpine:3.22.0 AS app-artifact-processor
# CI job places ./compiled here in the build context
COPY ./compiled /app/

# ---- Optional customizations on compiled output (branding, static, etc.)
# COPY docker/images/n8n-custom/branding/ /app/node_modules/n8n/packages/frontend/editor-ui/dist/
# COPY docker/images/n8n-custom/custom-nodes/ /app/node_modules/n8n/packages/nodes-base/dist/nodes/custom/

# = STAGE 3: Task Runner launcher (same as your n8n image)
FROM alpine:3.22.0 AS launcher-downloader
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION
RUN set -e; \
  case "$TARGETPLATFORM" in \
  "linux/amd64") ARCH_NAME="amd64" ;; \
  "linux/arm64") ARCH_NAME="arm64" ;; \
  *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
  esac; \
  mkdir /launcher-temp && cd /launcher-temp; \
  wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz"; \
  wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256"; \
  echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256) task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256; \
  sha256sum -c checksum.sha256; \
  mkdir -p /launcher-bin; \
  tar xzf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz -C /launcher-bin; \
  cd / && rm -rf /launcher-temp

# = STAGE 4: Final runtime
FROM system-deps AS runtime
ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu
ENV SHELL=/bin/sh
WORKDIR /home/node

# copy compiled app + launcher
COPY --from=app-artifact-processor /app /usr/local/lib/node_modules/n8n
COPY --from=launcher-downloader /launcher-bin/* /usr/local/bin/

# entrypoint + runners config (reuse your existing files if you want)
COPY docker/images/n8n/docker-entrypoint.sh /docker-entrypoint.sh
COPY docker/images/n8n/n8n-task-runners.json /etc/n8n-task-runners.json

# Rebuild native deps and link CLI
RUN cd /usr/local/lib/node_modules/n8n && \
  npm rebuild sqlite3 && \
  ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
  mkdir -p /home/node/.n8n && chown -R node:node /home/node

# (Optional) PDF rendering support – same as your n8n Dockerfile
RUN cd /usr/local/lib/node_modules/n8n/node_modules/pdfjs-dist && npm install @napi-rs/canvas

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini","--","/docker-entrypoint.sh"]
LABEL org.opencontainers.image.title="custom-n8n" \
  org.opencontainers.image.description="Custom n8n runtime built from precompiled artifacts" \
  org.opencontainers.image.source="https://github.com/${GITHUB_REPOSITORY}" \
  org.opencontainers.image.version=${N8N_VERSION}
