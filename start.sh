#!/bin/bash

# Claude Code Web - Start Script

set -e

cd "$(dirname "$0")"

# Configuration
PORT=${PORT:-3000}
USER_UID=$(id -u)
USER_GID=$(id -g)
USERS_FILE="data/users.conf"

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: docker is not installed"
    exit 1
fi

# Create data directory if it doesn't exist
mkdir -p data/environment data/claude-state

# Copy credentials to writable location (preserves read-only source)
if [ -f "$HOME/.claude/.credentials.json" ]; then
    cp "$HOME/.claude/.credentials.json" data/claude-state/
fi

# Load users from file if it exists
USERS=""
if [ -f "$USERS_FILE" ]; then
    # Read users file, skip comments and empty lines, join with commas
    USERS=$(grep -v '^#' "$USERS_FILE" | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
fi

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

# Show auth mode
if [ -n "$USERS" ]; then
    USER_COUNT=$(echo "$USERS" | tr ',' '\n' | wc -l)
    echo "Authentication: Enabled ($USER_COUNT user(s))"
else
    echo "Authentication: Disabled (single-user mode)"
    echo "  Tip: Run 'npm run add-user' to add users"
fi

echo "Starting Claude Code Web on port $PORT..."

# Build the image
docker build -t claude-code-web .

# Run the container with user's UID/GID for credential access
docker run -it --rm \
    -p "$PORT:3000" \
    -u "$USER_UID:$USER_GID" \
    -v "$(pwd)/data/claude-state:/home/node/.claude" \
    -v "$(pwd)/data:/app/data" \
    -v "/home:/home" \
    -e HOME=/home/node \
    ${USERS:+-e USERS="$USERS"} \
    ${SESSION_SECRET:+-e SESSION_SECRET="$SESSION_SECRET"} \
    ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
    claude-code-web
