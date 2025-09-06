ARG NODE_VERSION=22
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.0
ARG TARGETPLATFORM

# ==============================================================================
# STAGE 1: Use Official n8n Image as Base
# ==============================================================================
FROM n8nio/n8n:latest AS base

# ==============================================================================
# STAGE 2: Application Artifact Processor
# ==============================================================================
FROM alpine:3.22.0 AS app-artifact-processor

COPY ./compiled /app/

# ==============================================================================
# STAGE 3: Final Runtime Image
# ==============================================================================
FROM base AS runtime

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}

WORKDIR /home/node

# Remove the existing n8n installation and copy our custom version
RUN rm -rf /usr/local/lib/node_modules/n8n

# Copy our custom compiled n8n
COPY --from=app-artifact-processor /app /usr/local/lib/node_modules/n8n

# Fix permissions
RUN chmod +x /usr/local/lib/node_modules/n8n/bin/n8n && \
    chown -R node:node /usr/local/lib/node_modules/n8n

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
    org.opencontainers.image.description="Workflow Automation Tool" \
    org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
    org.opencontainers.image.url="https://n8n.io" \
    org.opencontainers.image.version=${N8N_VERSION}