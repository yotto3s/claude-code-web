# Claude Code Web

A web-based interface for Claude Code CLI that enables browser access to Claude's coding capabilities with full terminal integration.

## Features

- **Web Interface**: Access Claude Code through a browser-based chat interface
- **Integrated Terminal**: Full PTY terminal access alongside Claude conversations (via node-pty)
- **Streaming Responses**: Real-time streaming of Claude's responses in JSON stream format
- **Session Management**: Multiple concurrent Claude sessions with automatic cleanup
- **Persistent Environment**: Files created by Claude persist across sessions
- **Multi-user Support**: PAM authentication with per-user isolated Docker containers
- **Starship Prompt**: Beautiful shell prompt in the integrated terminal

## How It Works

Claude Code Web supports three deployment modes:

### 1. Host Mode (Recommended for Single Server)

Run directly on the host machine without Docker containers:

```bash
./start-host.sh
```

**Features:**
- Runs directly on the host system
- Multi-user with password authentication
- All users share the same Node.js process
- Simpler setup, no Docker required
- Best for single-server deployments

### 2. Hybrid Mode (Recommended for Multi-User with PAM Auth)

Gateway runs in Docker, sessions run on host:

```bash
./start-hybrid.sh
```

**Features:**
- Gateway authenticates via PAM (system users)
- Gateway runs in Docker container
- Sessions run directly on host (shared process)
- Best balance of security and simplicity
- Uses system authentication without container overhead

### 3. Gateway Mode (Maximum Isolation)

Use a gateway architecture with per-user Docker containers:

```bash
./start-gateway.sh
```

**Features:**
- Authenticates against `/etc/passwd` and `/etc/shadow` (supports yescrypt, SHA-512, SHA-256, MD5)
- Each user gets their own Docker container (`claude-user-<username>`)
- User's home directory is mounted with their UID/GID
- Claude credentials from user's `~/.claude` directory are used
- Complete isolation between users via Docker network
- Automatic container lifecycle management
- Maximum security but higher resource usage

## Quick Start

### Option 1: Host Mode (Simple Setup)

**Prerequisites:**
- Node.js 20+
- Claude Code CLI installed globally: `npm install -g @anthropic-ai/claude-code`
- Claude credentials in your `~/.claude/.credentials.json`

**Installation:**

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd claude-code-web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create user accounts:
   ```bash
   # Generate password hash
   echo -n "yourpassword" | sha256sum | cut -d' ' -f1
   
   # Set users (username:passwordhash)
   export USERS='admin:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
   ```

4. Start the server:
   ```bash
   ./start-host.sh
   ```

5. Access the web interface:
   ```
   http://localhost:3000
   ```

**Using .env file:**
```bash
# Copy example configuration
cp .env.host.example .env

# Edit .env with your settings
nano .env

# Start server (loads .env automatically)
./start-host.sh
```

### Option 2: Hybrid Mode (Gateway + Host Sessions)

**Prerequisites:**
- Docker
- Node.js 20+ (on host)
- Users with valid system credentials
- Claude Code CLI installed on host

**Installation:**

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd claude-code-web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start hybrid mode:
   ```bash
   ./start-hybrid.sh
   ```

4. Access the web interface and login with your system credentials:
   ```
   http://localhost:3000
   ```

The start script will:
- Start the host server on port 3001
- Build the hybrid gateway Docker image
- Start the gateway container on port 3000
- Configure networking between gateway and host

**Stop services:**
```bash
./stop-hybrid.sh
```

### Option 3: Gateway Mode (Docker Isolation)

**Prerequisites:**
- Docker
- Users with valid system credentials
- Claude Code CLI credentials in each user's `~/.claude/.credentials.json`

**Installation:**

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd claude-code-web
   ```

2. Start the gateway server (builds images automatically):
   ```bash
   ./start-gateway.sh
   ```

3. Access the web interface and login with your system credentials:
   ```
   http://localhost:3000
   ```

The start script will:
- Build the `claude-code-user` image (per-user container)
- Build the `claude-code-gateway` image (authentication gateway)
- Create the `claude-code-network` Docker network
- Start the gateway container with proper mounts

### Using a Different Port

**Host Mode:**
```bash
PORT=3001 ./start-host.sh
```

**Hybrid Mode:**
```bash
GATEWAY_PORT=3000 HOST_PORT=3001 ./start-hybrid.sh
```

**Gateway Mode:**
```bash
PORT=3001 ./start-gateway.sh
```

## Configuration

### Host Mode Configuration

Create a `.env` file or set environment variables:

```bash
# Server
PORT=3000
HOST=0.0.0.0

# Session secret (generate with: openssl rand -hex 32)
SESSION_SECRET=your_random_secret_here

# Users (format: username:passwordhash,username2:passwordhash2)
# Generate hash: echo -n "password" | sha256sum | cut -d' ' -f1
USERS=admin:5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8

# Session management
MAX_SESSIONS=5
SESSION_TIMEOUT=3600000
```

See [.env.host.example](.env.host.example) for a complete configuration template.

### Hybrid Mode Configuration

Configure ports via environment variables:

```bash
# Gateway port (external access)
GATEWAY_PORT=3000

# Host server port (internal, accessed by gateway)
HOST_PORT=3001

# Session secret (optional, auto-generated if not set)
SESSION_SECRET=your_random_secret_here
```

The gateway will use PAM authentication against system users. Ensure:
- Users exist in `/etc/passwd`
- Gateway container has read access to `/etc/shadow`
- Claude CLI is installed on the host

### Gateway Mode Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_SESSIONS` | `5` | Maximum concurrent Claude sessions per user |
| `SESSION_TIMEOUT` | `3600000` | Session timeout in ms (1 hour) |
| `SESSION_SECRET` | (auto-generated) | Secret for signing session cookies |
| `ANTHROPIC_API_KEY` | - | API key for Claude (optional if using CLI credentials) |

### Docker Containers

The gateway architecture uses two container images:

1. **claude-code-gateway** - Authentication and proxy server
   - Handles PAM authentication
   - Spawns and manages user containers
   - Proxies HTTP/WebSocket to user containers

2. **claude-code-user** - Per-user Claude environment
   - Runs as the authenticated user (UID/GID)
   - Contains Claude CLI and node-pty for terminal
   - Includes Starship prompt for beautiful shell

## Usage

### Web Interface

1. Open the web interface in your browser
2. Login with your system credentials
3. Click "New Session" to start a Claude conversation
4. Type messages and receive streaming responses
5. Use the integrated terminal for shell access
6. Files created by Claude persist in your home directory

### Working Directory

Claude sessions run in the user's home directory. Files persist across sessions in `~/.claude/` and throughout the user's home directory.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main chat interface |
| GET | `/login` | Login page |
| POST | `/api/login` | Authenticate user |
| POST | `/api/logout` | End session |
| GET | `/api/sessions` | List active sessions |
| POST | `/api/sessions` | Create new session |
| DELETE | `/api/sessions/:id` | Terminate session |
| GET | `/api/container/status` | Container status |

### WebSocket Protocol

Connect to `/ws` for real-time communication:

```javascript
// Create session
ws.send(JSON.stringify({ type: 'create_session' }));

// Send message to Claude
ws.send(JSON.stringify({ type: 'message', content: 'Hello Claude' }));

// Cancel current operation
ws.send(JSON.stringify({ type: 'cancel' }));

// Terminal operations
ws.send(JSON.stringify({ type: 'terminal_create' }));
ws.send(JSON.stringify({ type: 'terminal_input', terminalId: '...', data: 'ls -la\n' }));
ws.send(JSON.stringify({ type: 'terminal_resize', terminalId: '...', cols: 80, rows: 24 }));
```

## Administration

### Host Mode

**View Logs:**
```bash
# View server output
# (logs are displayed in the terminal where you ran start-host.sh)
```

**Stop Server:**
```bash
# Press Ctrl+C in the terminal running the server
```

**Restart Server:**
```bash
./start-host.sh
```

### Hybrid Mode

**View Logs:**
```bash
# Gateway logs
docker logs -f claude-code-gateway-hybrid

# Host server logs
tail -f ./data/server.log
```

**Stop Services:**
```bash
./stop-hybrid.sh
```

**Restart Services:**
```bash
./stop-hybrid.sh
./start-hybrid.sh
```

**Check Status:**
```bash
# Check gateway
docker ps | grep claude-code-gateway-hybrid

# Check host server
curl http://localhost:3001/api/health

# Check from gateway health endpoint
curl http://localhost:3000/health
```

### Gateway Mode

**View Logs:**
```bash
# Gateway container logs
docker logs -f claude-code-gateway

# User container logs
docker logs -f claude-user-<username>
```

**List Running Containers:**

```bash
docker ps | grep claude
```

**Stop User Container:**

```bash
docker stop claude-user-<username>
```

**Restart Gateway:**

```bash
docker stop claude-code-gateway
./start-gateway.sh
```

## Troubleshooting

### Host Mode Issues

**Session Not Starting**
- Verify Claude CLI is installed: `which claude`
- Check Claude credentials: `ls -la ~/.claude/.credentials.json`
- Ensure Node.js is installed: `node --version`

**Authentication Failed**
- Check password hash is correct
- Verify USERS environment variable format
- Generate new hash: `echo -n "password" | sha256sum | cut -d' ' -f1`

**Port Already in Use**
```bash
PORT=3001 ./start-host.sh
```

### Hybrid Mode Issues

**Gateway Can't Reach Host Server**
- Verify host server is running: `curl http://localhost:3001/api/health`
- Check `./data/server.log` for errors
- On Linux, ensure `172.17.0.1` is accessible from container
- Try setting custom host IP: `HOST_SERVER_IP=172.17.0.1 ./start-hybrid.sh`

**Authentication Failed**
- Verify the user exists in `/etc/passwd`
- Check `/etc/shadow` is readable by the gateway container
- Ensure password hash algorithm is supported

**Gateway Not Starting**
- Check Docker is running: `docker ps`
- View gateway logs: `docker logs claude-code-gateway-hybrid`
- Ensure ports are available: `lsof -i :3000`

**Sessions Not Working**
- Check host server logs: `tail -f ./data/server.log`
- Verify Claude CLI is installed on host: `which claude`
- Check credentials: `ls -la ~/.claude/.credentials.json`

### Gateway Mode Issues

**Authentication Failed**

- Verify the user exists in `/etc/passwd`
- Check `/etc/shadow` is readable by the container
- Ensure password hash algorithm is supported (yescrypt, SHA-512, SHA-256, MD5)

**Container Not Starting**

- Check Docker socket is accessible: `docker ps`
- Verify user container image exists: `docker images | grep claude-code-user`
- Check logs: `docker logs claude-code-gateway`

**Session Not Starting**

- Check Claude CLI is installed: `docker exec claude-user-<username> which claude`
- Verify credentials exist in user's `~/.claude` directory

**Permission Errors**

- Ensure user's home directory exists and is accessible
- Check UID/GID mapping is correct

**Port Already in Use**

```bash
PORT=3001 ./start-gateway.sh
```

## Development

### Local Development (Host Mode)

```bash
npm install
node server.js
```

### Local Development (Hybrid Mode)

```bash
# Terminal 1: Start host server
PORT=3001 node server.js

# Terminal 2: Start gateway
docker build -t claude-code-gateway-hybrid -f Dockerfile.gateway-hybrid .
docker run -p 3000:3000 \
  -e HOST_SERVER_IP=host.docker.internal \
  -e HOST_SERVER_PORT=3001 \
  -v /etc/passwd:/etc/passwd:ro \
  -v /etc/shadow:/etc/shadow:ro \
  --add-host=host.docker.internal:host-gateway \
  claude-code-gateway-hybrid
```

### Local Development (Gateway Mode)

```bash
npm install
node gateway.js  # Requires Docker and host access
```

### Building Images

```bash
# Build user container
docker build -t claude-code-user -f Dockerfile.user .

# Build gateway container
docker build -t claude-code-gateway -f Dockerfile.gateway .
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `ws` | WebSocket server |
| `cookie-parser` | Parse cookies for sessions |
| `uuid` | Generate unique session IDs |
| `node-pty` | Terminal emulation (user containers) |
| `http-proxy` | Proxy requests to user containers (gateway) |

## License

MIT
