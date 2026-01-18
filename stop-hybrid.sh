#!/bin/bash

# Stop Hybrid Mode Services

set -e

echo "Stopping Claude Code Web Hybrid Mode..."

GATEWAY_CONTAINER="claude-code-gateway-hybrid"

# Stop gateway container
echo "Stopping gateway container..."
docker stop ${GATEWAY_CONTAINER} 2>/dev/null && echo "  Gateway stopped" || echo "  Gateway not running"
docker rm ${GATEWAY_CONTAINER} 2>/dev/null || true

# Stop host server
if [ -f ./data/server.pid ]; then
  SERVER_PID=$(cat ./data/server.pid)
  echo "Stopping host server (PID: ${SERVER_PID})..."
  
  if kill -0 ${SERVER_PID} 2>/dev/null; then
    kill ${SERVER_PID}
    echo "  Server stopped"
  else
    echo "  Server not running"
  fi
  
  rm ./data/server.pid
else
  echo "Host server PID file not found"
  echo "Checking for server process on port 3001..."
  PID=$(lsof -ti:3001 2>/dev/null || true)
  if [ ! -z "$PID" ]; then
    echo "  Found process $PID, stopping..."
    kill $PID
    echo "  Server stopped"
  else
    echo "  No server process found"
  fi
fi

echo ""
echo "Hybrid mode services stopped"
