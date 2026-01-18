#!/bin/bash

# Claude Code Web Gateway - Start Script
# This runs the gateway server in Docker, which authenticates users
# and spawns per-user Docker containers

set -e

cd "$(dirname "$0")"

# Configuration
PORT=${PORT:-3000}

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: docker is not installed"
    exit 1
fi

# Create data directories
mkdir -p data/environment data/claude-state

# Generate session secret if not set (persist it for consistent sessions)
if [ -z "$SESSION_SECRET" ]; then
    SECRET_FILE="data/.session-secret"
    if [ -f "$SECRET_FILE" ]; then
        SESSION_SECRET=$(cat "$SECRET_FILE")
    else
        SESSION_SECRET=$(openssl rand -hex 32)
        echo "$SESSION_SECRET" > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
    fi
fi

echo ""
echo "Building Docker images..."
echo ""

# Build the user container image first
echo "Building user container image (claude-code-user)..."
docker build -t claude-code-user -f Dockerfile.user .

# Build the gateway container image
echo "Building gateway container image (claude-code-gateway)..."
docker build -t claude-code-gateway -f Dockerfile.gateway .

echo ""
echo "Starting Claude Code Web Gateway..."
echo ""
echo "  Authentication: System PAM (use your server login)"
echo "  Mode: Per-user isolated containers"
echo "  Port: $PORT"
echo ""

# Create the Docker network if it doesn't exist
docker network create claude-code-network 2>/dev/null || true

# Run the gateway container with:
# - Docker socket mounted (to spawn user containers)
# - /etc/passwd and /etc/shadow mounted (for PAM auth)
# - /home mounted (for user home directories)
# - Session secret passed in
# - Connected to the shared network
docker run -it --rm --init \
    --name claude-code-gateway \
    --network claude-code-network \
    -p "$PORT:3000" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/shadow:/etc/shadow:ro \
    -v /etc/group:/etc/group:ro \
    -v /home:/home \
    -v "$(pwd)/data:/app/data" \
    -e SESSION_SECRET="$SESSION_SECRET" \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    claude-code-gateway
