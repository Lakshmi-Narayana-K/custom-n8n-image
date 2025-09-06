ARG NODE_VERSION=22
ARG N8N_VERSION=snapshot
ARG LAUNCHER_VERSION=1.3.0
ARG TARGETPLATFORM

# ==============================================================================
# STAGE 1: Application Artifact Processor
# ==============================================================================
FROM alpine:3.22.0 AS app-artifact-processor

COPY ./compiled /app/

# ==============================================================================
# STAGE 2: Final Runtime Image (Start Fresh)
# ==============================================================================
FROM n8nio/n8n:latest AS runtime

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}

WORKDIR /home/node

# Copy our custom compiled n8n to a new location
COPY --from=app-artifact-processor /app /usr/local/lib/node_modules/n8n-custom

# Create a new n8n directory and copy our custom version
RUN mkdir -p /usr/local/lib/node_modules/n8n-new && \
    cp -r /usr/local/lib/node_modules/n8n-custom/* /usr/local/lib/node_modules/n8n-new/ && \
    rm -rf /usr/local/lib/node_modules/n8n-custom && \
    rm -rf /usr/local/lib/node_modules/n8n && \
    mv /usr/local/lib/node_modules/n8n-new /usr/local/lib/node_modules/n8n && \
    chmod +x /usr/local/lib/node_modules/n8n/bin/n8n && \
    chown -R node:node /usr/local/lib/node_modules/n8n

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
    org.opencontainers.image.description="Workflow Automation Tool" \
    org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
    org.opencontainers.image.url="https://n8n.io" \
    org.opencontainers.image.version=${N8N_VERSION}