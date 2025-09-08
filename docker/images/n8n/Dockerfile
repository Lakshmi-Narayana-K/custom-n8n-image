# syntax=docker/dockerfile:1

ARG NODE_VERSION=20
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.0
ARG TARGETPLATFORM

# --- Stage 1: compiled artifact from CI ---
FROM debian:bookworm-slim AS app-artifact
WORKDIR /app
# We rely on compiled.tar.gz (created in CI) to preserve pnpm symlinks
COPY ./compiled /app/

# --- Stage 2: launcher download (works on Debian too) ---
FROM debian:bookworm-slim AS launcher
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
RUN set -e; \
    case "$TARGETPLATFORM" in \
    "linux/amd64") ARCH_NAME="amd64" ;; \
    "linux/arm64") ARCH_NAME="arm64" ;; \
    *) echo "Unsupported platform: $TARGETPLATFORM" && exit 1 ;; \
    esac; \
    mkdir /launcher-temp && cd /launcher-temp && \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" && \
    wget -q "https://github.com/n8n-io/task-runner-launcher/releases/download/${LAUNCHER_VERSION}/task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256" && \
    echo "$(cat task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz.sha256)  task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz" > checksum.sha256 && \
    sha256sum -c checksum.sha256 && \
    mkdir -p /launcher-bin && \
    tar xzf task-runner-launcher-${LAUNCHER_VERSION}-linux-${ARCH_NAME}.tar.gz -C /launcher-bin && \
    cd / && rm -rf /launcher-temp

# --- Stage 3: final runtime (glibc; no sqlite3 build needed) ---
FROM node:${NODE_VERSION}-slim AS runtime

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev

ENV NODE_ENV=production \
    N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE} \
    SHELL=/bin/sh

# Base OS deps comparable to n8nio/base
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini tzdata ca-certificates graphicsmagick fontconfig curl jq \
    libcairo2 libjpeg62-turbo libgif7 libpangocairo-1.0-0 libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

# full-icu like upstream
RUN npm i -g full-icu@1.5.0
ENV NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu

WORKDIR /home/node

# App + launcher + entrypoint/config
COPY --from=app-artifact /app /usr/local/lib/node_modules/n8n
COPY --from=launcher /launcher-bin/* /usr/local/bin/
COPY docker/images/n8n/docker-entrypoint.sh /
COPY docker/images/n8n/n8n-task-runners.json /etc/n8n-task-runners.json

# Ensure executables & symlink
RUN set -eux; \
    chmod +x /docker-entrypoint.sh; \
    chmod +x /usr/local/lib/node_modules/n8n/bin/n8n; \
    ln -sf /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n; \
    mkdir -p /home/node/.n8n && chown -R node:node /home/node

# Canvas binding (should download prebuilt on glibc)
RUN cd /usr/local/lib/node_modules/n8n/node_modules/pdfjs-dist && npm install @napi-rs/canvas

EXPOSE 5678
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
    org.opencontainers.image.description="Workflow Automation Tool" \
    org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
    org.opencontainers.image.url="https://n8n.io" \
    org.opencontainers.image.version=${N8N_VERSION}
