#!/bin/bash

# Claude Code Web - Startup Script
# Gateway runs in Docker, sessions run on host

set -e

echo "Starting Claude Code Web..."
echo ""
echo "  Gateway: Docker container (port 3000)"
echo "  Server: Host machine (port 3001)"
echo ""

# Configuration
GATEWAY_PORT=${GATEWAY_PORT:-3000}
HOST_PORT=${HOST_PORT:-3001}
GATEWAY_IMAGE="claude-code-gateway"
GATEWAY_CONTAINER="claude-code-gateway"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed or not in PATH"
  exit 1
fi

# Step 1: Start the host server in the background
echo "Step 1: Starting host server on port ${HOST_PORT}..."

# Check if server is already running
if lsof -Pi :${HOST_PORT} -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "  Server already running on port ${HOST_PORT}"
else
  # Start server in background
  export PORT=${HOST_PORT}
  export SINGLE_USER_MODE=false
  export USERS=""  # Auth handled by gateway
  
  # Ensure data directories exist
  mkdir -p ./data/claude-state/projects
  mkdir -p ./data/claude-state/debug  
  mkdir -p ./data/claude-state/statsig
  mkdir -p ./data/claude-state/todos
  mkdir -p ./data/environment
  
  # Check if node_modules exists
  if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    npm install
  fi
  
  # Start server
  nohup node server.js > ./data/server.log 2>&1 &
  SERVER_PID=$!
  echo "  Server started (PID: ${SERVER_PID})"
  echo ${SERVER_PID} > ./data/server.pid
  
  # Wait for server to be ready
  echo "  Waiting for server to be ready..."
  for i in {1..30}; do
    if curl -s http://localhost:${HOST_PORT}/api/health > /dev/null 2>&1; then
      echo "  Server is ready!"
      break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
      echo "  Warning: Server may not have started correctly"
      echo "  Check logs at ./data/server.log"
    fi
  done
fi

# Step 2: Build gateway Docker image
echo ""
echo "Step 2: Building gateway Docker image..."

# Create a custom Dockerfile for gateway
cat > Dockerfile.gateway << 'EOF'
FROM node:20-bookworm-slim

# Install Docker CLI and other tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    whois \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Remove node-pty from dependencies (not needed in gateway)
RUN node -e "const p=require('./package.json'); delete p.dependencies['node-pty']; require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2))"

# Install dependencies
RUN npm install --production

# Copy application files
COPY gateway.js ./
COPY src/ ./src/
COPY public/ ./public/

# Create data directory
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose port
EXPOSE 3000

# Start gateway
CMD ["node", "gateway.js"]
EOF

docker build -t ${GATEWAY_IMAGE} -f Dockerfile.gateway . 2>&1 | tail -20

echo "  Gateway image built successfully"

# Step 3: Stop old gateway container if running
echo ""
echo "Step 3: Stopping old gateway container..."
docker stop ${GATEWAY_CONTAINER} 2>/dev/null || true
docker rm -f ${GATEWAY_CONTAINER} 2>/dev/null || true

# Step 4: Start gateway container
echo ""
echo "Step 4: Starting gateway container..."

# Detect host IP for container to reach host
if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "msys" ]]; then
  # Mac or Windows - use host.docker.internal
  HOST_SERVER_IP="host.docker.internal"
else
  # Linux - use host network or bridge IP
  HOST_SERVER_IP="172.17.0.1"
fi

docker run -d \
  --name ${GATEWAY_CONTAINER} \
  -p ${GATEWAY_PORT}:3000 \
  -e HOST_SERVER_IP=${HOST_SERVER_IP} \
  -e HOST_SERVER_PORT=${HOST_PORT} \
  -e SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -hex 32)}" \
  -v /etc/passwd:/etc/passwd:ro \
  -v /etc/shadow:/etc/shadow:ro \
  -v /etc/group:/etc/group:ro \
  --add-host=host.docker.internal:host-gateway \
  ${GATEWAY_IMAGE}

# Wait for gateway to be ready
echo "  Waiting for gateway to be ready..."
sleep 2

if docker ps | grep -q ${GATEWAY_CONTAINER}; then
  echo "  Gateway started successfully!"
else
  echo "  Error: Gateway failed to start"
  echo "  Checking logs:"
  docker logs ${GATEWAY_CONTAINER}
  exit 1
fi

# Display startup information
echo ""
cat << EOF
╔══════════════════════════════════════════════════════╗
║  Claude Code Web                                    ║
║                                                      ║
║  Gateway:     http://0.0.0.0:${GATEWAY_PORT}                        ║
║  Host Server: http://localhost:${HOST_PORT}                        ║
║                                                      ║
║  Auth: PAM (System Users)                           ║
║  Mode: Gateway in Docker, Sessions on Host          ║
╚══════════════════════════════════════════════════════╝

Access the web interface at: http://localhost:${GATEWAY_PORT}
Login with your system credentials

Logs:
  Gateway:     docker logs -f ${GATEWAY_CONTAINER}
  Host Server: tail -f ./data/server.log

To stop:
  ./stop.sh

EOF
