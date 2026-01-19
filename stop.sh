#!/bin/bash

# Stop Claude Code Web Services

echo "Stopping Claude Code Web..."

GATEWAY_CONTAINER="claude-code-gateway"
HOST_PORT=${HOST_PORT:-3001}

# Stop gateway container
echo "Stopping gateway container..."
docker stop ${GATEWAY_CONTAINER} 2>/dev/null && echo "  Gateway stopped" || echo "  Gateway not running"
docker rm ${GATEWAY_CONTAINER} 2>/dev/null || true

# Stop host server - try multiple methods
echo "Stopping host server..."

STOPPED=false

# Method 1: Kill by port
PID=$(lsof -ti:${HOST_PORT} 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "  Found server on port ${HOST_PORT} (PID: $PID)"
  kill $PID 2>/dev/null && STOPPED=true
fi

# Method 2: Kill by process name (backup)
if ! $STOPPED; then
  pkill -f "node server.js" 2>/dev/null && STOPPED=true
fi

# Clean up PID file
rm -f ./data/server.pid

if $STOPPED; then
  echo "  Server stopped"
else
  echo "  Server not running"
fi

echo ""
echo "Claude Code Web services stopped"
