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

Claude Code Web uses a gateway architecture for multi-user deployments:

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

## Quick Start

### Prerequisites

- Docker
- Users with valid system credentials
- Claude Code CLI credentials in each user's `~/.claude/.credentials.json`

### Installation

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

```bash
PORT=3001 ./start-gateway.sh
```

## Configuration

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

### View Logs

```bash
# Gateway container logs
docker logs -f claude-code-gateway

# User container logs
docker logs -f claude-user-<username>
```

### List Running Containers

```bash
docker ps | grep claude
```

### Stop User Container

```bash
docker stop claude-user-<username>
```

### Restart Gateway

```bash
docker stop claude-code-gateway
./start-gateway.sh
```

## Troubleshooting

### Authentication Failed

- Verify the user exists in `/etc/passwd`
- Check `/etc/shadow` is readable by the container
- Ensure password hash algorithm is supported (yescrypt, SHA-512, SHA-256, MD5)

### Container Not Starting

- Check Docker socket is accessible: `docker ps`
- Verify user container image exists: `docker images | grep claude-code-user`
- Check logs: `docker logs claude-code-gateway`

### Session Not Starting

- Check Claude CLI is installed: `docker exec claude-user-<username> which claude`
- Verify credentials exist in user's `~/.claude` directory

### Permission Errors

- Ensure user's home directory exists and is accessible
- Check UID/GID mapping is correct

### Port Already in Use

```bash
PORT=3001 ./start-gateway.sh
```

## Development

### Local Development

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
