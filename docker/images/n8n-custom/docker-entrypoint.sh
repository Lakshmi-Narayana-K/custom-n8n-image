#!/usr/bin/env bash
set -euo pipefail

# Optional: trust custom certs like upstream entrypoint
if [ -d /opt/custom-certificates ]; then
  echo "Trusting custom certificates from /opt/custom-certificates."
  export NODE_OPTIONS="--use-openssl-ca ${NODE_OPTIONS:-}"
  export SSL_CERT_DIR=/opt/custom-certificates
  c_rehash /opt/custom-certificates || true
fi

# Defaults (can be overridden by env)
: "${N8N_PORT:=5678}"
: "${N8N_LOG_LEVEL:=info}"

echo "Starting n8n on port ${N8N_PORT} (log level: ${N8N_LOG_LEVEL})"

# Hand off to n8n
exec "$@"
