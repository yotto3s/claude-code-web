#!/bin/bash

# Claude Code Web - Host Mode Startup Script
# This runs the application directly on the host machine without containers

set -e

echo "Starting Claude Code Web in Host Mode..."
echo ""

# Load .env file if it exists
if [ -f .env ]; then
  echo "Loading configuration from .env file..."
  export $(cat .env | grep -v '^#' | xargs)
fi

echo "  Mode: Direct host execution"
echo "  Port: ${PORT:-3000}"
echo "  Auth: Multi-user with login"
echo ""

# Set environment variables with defaults
export SINGLE_USER_MODE=false
export PORT=${PORT:-3000}
export HOST=${HOST:-0.0.0.0}

# Generate session secret if not set
if [ -z "$SESSION_SECRET" ]; then
  export SESSION_SECRET=$(openssl rand -hex 32)
fi

# Set users from environment or use default
# Format: "username:passwordhash,username2:passwordhash2"
# To generate a password hash: echo -n "password" | sha256sum | cut -d' ' -f1
if [ -z "$USERS" ]; then
  echo "Warning: No USERS environment variable set."
  echo "To set users, export USERS like this:"
  echo "  export USERS='admin:\$(echo -n \"yourpassword\" | sha256sum | cut -d\" \" -f1)'"
  echo ""
  echo "Or copy .env.host.example to .env and configure it."
  echo ""
  echo "Running without authentication (development mode)..."
  export USERS=""
fi

# Ensure data directory exists
mkdir -p ./data/claude-state/projects
mkdir -p ./data/claude-state/debug
mkdir -p ./data/claude-state/statsig
mkdir -p ./data/claude-state/todos
mkdir -p ./data/environment

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
  echo ""
fi

# Check if Claude CLI is installed
if ! command -v claude &> /dev/null; then
  echo "Warning: Claude CLI not found in PATH."
  echo "Install it with: npm install -g @anthropic-ai/claude-code"
  echo ""
fi

# Display startup banner
cat << EOF
╔══════════════════════════════════════════════════════╗
║  Claude Code Web - Host Mode                        ║
║                                                      ║
║  Listening: http://${HOST}:${PORT}                  ║
║                                                      ║
║  Mode: Running directly on host                     ║
║  Multi-user: Yes (login required)                   ║
╚══════════════════════════════════════════════════════╝

EOF

# Start the server
node server.js
