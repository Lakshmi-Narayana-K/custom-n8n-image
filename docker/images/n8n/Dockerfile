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
# STAGE 2: Final Runtime Image (Use Official n8n as Base)
# ==============================================================================
FROM n8nio/n8n:latest AS runtime

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}

WORKDIR /home/node

# Copy our custom compiled n8n to a safe location
COPY --from=app-artifact-processor /app /opt/custom-n8n

# Create a custom entrypoint in a writable location
RUN echo '#!/bin/sh' > /tmp/custom-entrypoint.sh && \
    echo 'export N8N_PATH=/opt/custom-n8n' >> /tmp/custom-entrypoint.sh && \
    echo 'exec /opt/custom-n8n/bin/n8n "$@"' >> /tmp/custom-entrypoint.sh && \
    chmod +x /tmp/custom-entrypoint.sh && \
    mv /tmp/custom-entrypoint.sh /home/node/custom-entrypoint.sh

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/home/node/custom-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
    org.opencontainers.image.description="Workflow Automation Tool" \
    org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
    org.opencontainers.image.url="https://n8n.io" \
    org.opencontainers.image.version=${N8N_VERSION}