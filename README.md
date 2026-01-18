# Claude Code Web

A web-based interface for Claude Code CLI that enables browser access to Claude's coding capabilities with full terminal integration.

## Features

- **Web Interface**: Access Claude Code through a browser-based chat interface
- **Integrated Terminal**: Full PTY terminal access alongside Claude conversations (via node-pty)
- **Streaming Responses**: Real-time streaming of Claude's responses in JSON stream format
- **Session Management**: Multiple concurrent Claude sessions with automatic cleanup
- **Persistent Environment**: Files created by Claude persist across sessions
- **Multi-user Support**: PAM authentication with gateway in Docker
- **Starship Prompt**: Beautiful shell prompt in the integrated terminal

## Architecture

Claude Code Web uses a hybrid architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host System                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           Gateway Container (Ubuntu 24.04)                │   │
│  │                    Port 3000                              │   │
│  │  ┌────────────┐   ┌────────────┐   ┌────────────────┐    │   │
│  │  │  Browser   │──▶│  PAM Auth  │──▶│  HTTP/WS       │    │   │
│  │  │  Requests  │   │  (Python)  │   │  Proxy         │────┼───┼──┐
│  │  └────────────┘   └────────────┘   └────────────────┘    │   │  │
│  │                   /etc/passwd                             │   │  │
│  │                   /etc/shadow                             │   │  │
│  └──────────────────────────────────────────────────────────┘   │  │
│                                                                  │  │
│  ┌──────────────────────────────────────────────────────────┐   │  │
│  │              Host Server (Node.js)                        │◀──┘  │
│  │                    Port 3001                              │      │
│  │  ┌────────────┐   ┌────────────┐   ┌────────────────┐    │      │
│  │  │  Session   │   │  Claude    │   │  Terminal      │    │      │
│  │  │  Manager   │   │  Process   │   │  Manager (PTY) │    │      │
│  │  └────────────┘   └────────────┘   └────────────────┘    │      │
│  └──────────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Gateway (Docker)**: Handles PAM authentication, proxies to host server
- **Host Server (Node.js)**: Manages Claude sessions and terminals on host
- **Base Image**: Ubuntu 24.04 for yescrypt password hash support

**Features:**
- Authenticates against `/etc/passwd` and `/etc/shadow`
- Supports password hash algorithms: yescrypt ($y$), SHA-512 ($6$), SHA-256 ($5$), MD5 ($1$)
- Uses Python's crypt module for password verification
- Direct access to host file system
- Claude credentials loaded from user's `~/.claude` directory

## Quick Start

### Prerequisites

- Docker
- Node.js 20+ (on host)
- Users with valid system credentials
- Claude Code CLI installed on host: `npm install -g @anthropic-ai/claude-code`
- Claude credentials in user's `~/.claude/.credentials.json`

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd claude-code-web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   ./start.sh
   ```

4. Access the web interface and login with your system credentials:
   ```
   http://localhost:3000
   ```

The start script will:
- Start the Node.js server on port 3001 (host machine)
- Build the gateway Docker image (Ubuntu 24.04)
- Start the gateway container on port 3000
- Configure networking between gateway and host

### Stop Services

```bash
./stop.sh
```

## Configuration

### Environment Variables

Configure via environment variables:

```bash
# Gateway port (external access)
GATEWAY_PORT=3000

# Host server port (internal, accessed by gateway)
HOST_PORT=3001

# Session secret (optional, auto-generated if not set)
SESSION_SECRET=your_random_secret_here
```

Usage:
```bash
GATEWAY_PORT=8080 HOST_PORT=8081 ./start.sh
```

## Administration

### View Logs

**Gateway logs:**
```bash
docker logs -f claude-code-gateway
```

**Host server logs:**
```bash
tail -f ./data/server.log
```

**Check status:**
```bash
# Check gateway is running
docker ps | grep claude-code-gateway

# Check host server health
curl http://localhost:3001/api/health

# Check gateway health
curl http://localhost:3000/health
```

### Stop Services

```bash
./stop.sh
```

### Restart Services

```bash
./stop.sh
./start.sh
```

## Troubleshooting

### Gateway Can't Reach Host Server

**Issue:** Error about host server not accessible

**Solutions:**
- Verify host server is running: `curl http://localhost:3001/api/health`
- Check host server logs: `tail -f ./data/server.log`
- On Linux, ensure Docker can reach host via `172.17.0.1`
- Check HOST_SERVER_IP environment variable in gateway container

### Authentication Failed

**Issue:** Login fails with invalid credentials

**Solutions:**
- Verify the user exists: `id username`
- Check `/etc/shadow` is readable by Docker container
- Ensure password is correct
- Verify Python3 is installed in gateway container
- Check gateway logs for password verification errors

### Gateway Not Starting

**Issue:** Docker container fails to start

**Solutions:**
- Check Docker is running: `docker ps`
- View gateway logs: `docker logs claude-code-gateway`
- Ensure port 3000 is available: `lsof -i :3000`
- Clean up and restart:
  ```bash
  ./stop.sh
  docker rm -f claude-code-gateway 2>/dev/null
  ./start.sh
  ```

### Sessions Not Working

**Issue:** Logged in but sessions don't start

**Solutions:**
- Check Claude CLI is installed on host: `which claude`
- Verify Claude credentials: `ls -la ~/.claude/.credentials.json`
- Check host server logs for errors
- Ensure ANTHROPIC_API_KEY is set if needed: `export ANTHROPIC_API_KEY=your-key`

### WebSocket Connection Failed

**Issue:** WebSocket errors in browser console

**Solutions:**
- Ensure you're logged in (session cookie required)
- Check gateway logs for WebSocket proxy errors
- Verify host server is running and accessible

### Port Already in Use

**Issue:** Port 3000 or 3001 already in use

**Solutions:**
```bash
# Find and kill process on port
sudo fuser -k 3000/tcp

# Use different ports
GATEWAY_PORT=8080 HOST_PORT=8081 ./start.sh
```

## Development

### Local Development

**Terminal 1 - Host Server:**
```bash
PORT=3001 SINGLE_USER_MODE=true node server.js
```

**Terminal 2 - Gateway:**
```bash
docker build -t claude-code-gateway -f Dockerfile.gateway .
docker run -p 3000:3000 \
  -e HOST_SERVER_IP=172.17.0.1 \
  -e HOST_SERVER_PORT=3001 \
  -v /etc/passwd:/etc/passwd:ro \
  -v /etc/shadow:/etc/shadow:ro \
  --add-host=host.docker.internal:host-gateway \
  claude-code-gateway
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/login` | Login page |
| POST | `/api/login` | Authenticate user |
| POST | `/api/logout` | End session |
| GET | `/api/sessions` | List active sessions |
| POST | `/api/sessions` | Create new session |
| DELETE | `/api/sessions/:id` | Terminate session |
| GET | `/api/health` | Health check (no auth) |
| GET | `/health` | Gateway health check |

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

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `ws` | WebSocket server |
| `cookie-parser` | Parse cookies for sessions |
| `uuid` | Generate unique session IDs |
| `node-pty` | Terminal emulation |
| `http-proxy` | Proxy requests in gateway |

## License

MIT
