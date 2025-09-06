FROM n8nio/n8n:latest

# Copy our custom compiled n8n to a safe location
COPY ./compiled /opt/custom-n8n

# Set environment to use our custom version
ENV N8N_PATH=/opt/custom-n8n

# Run with node instead of the binary
ENTRYPOINT ["node", "/opt/custom-n8n/bin/n8n"]