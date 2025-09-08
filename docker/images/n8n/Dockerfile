# syntax=docker/dockerfile:1

ARG NODE_VERSION=20
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.0
ARG TARGETPLATFORM

# ------------------------------------------------------------------------------
# STAGE 1: bring in compiled artifact produced by CI (./compiled)
# ------------------------------------------------------------------------------
FROM alpine:3.22 AS app-artifact
WORKDIR /app
COPY ./compiled /app/

# ------------------------------------------------------------------------------
# STAGE 2: download task-runner launcher (per-arch)
# ------------------------------------------------------------------------------
FROM alpine:3.22 AS launcher
ARG TARGETPLATFORM
ARG LAUNCHER_VERSION
RUN apk add --no-cache wget ca-certificates openssl && \
    set -e; \
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

# ------------------------------------------------------------------------------
# STAGE 3: final runtime (uses n8nio/base:<node>)
# ------------------------------------------------------------------------------
FROM n8nio/base:${NODE_VERSION} AS runtime

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev

ENV NODE_ENV=production \
    N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE} \
    NODE_ICU_DATA=/usr/local/lib/node_modules/full-icu \
    SHELL=/bin/sh

WORKDIR /home/node

# app + launcher + entrypoint
COPY --from=app-artifact /app /usr/local/lib/node_modules/n8n
COPY --from=launcher /launcher-bin/* /usr/local/bin/
COPY docker/images/n8n/docker-entrypoint.sh /
COPY docker/images/n8n/n8n-task-runners.json /etc/n8n-task-runners.json

# make sure entrypoint & n8n are executable and LF (not CRLF)
RUN chmod +x /docker-entrypoint.sh && \
    chmod +x /usr/local/lib/node_modules/n8n/bin/n8n && \
    ln -sf /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
    mkdir -p /home/node/.n8n && chown -R node:node /home/node

# native/binary bits the original image does
# (these two lines matter; they avoid runtime native/ABI and pdf/canvas issues)
RUN cd /usr/local/lib/node_modules/n8n && npm rebuild sqlite3
RUN cd /usr/local/lib/node_modules/n8n/node_modules/pdfjs-dist && npm install @napi-rs/canvas

# libs needed by @napi-rs/canvas at runtime
RUN apk add --no-cache \
    cairo-dev jpeg-dev pango-dev musl-dev giflib-dev pixman-dev \
    pangomm-dev libjpeg-turbo-dev freetype-dev

EXPOSE 5678
USER node

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
    org.opencontainers.image.description="Workflow Automation Tool" \
    org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
    org.opencontainers.image.url="https://n8n.io" \
    org.opencontainers.image.version=${N8N_VERSION}
