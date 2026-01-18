# Claude Code Web

A web-based interface for Claude Code CLI that enables browser access to Claude's coding capabilities.

## Features

- **Web Interface**: Access Claude Code through a browser-based chat interface
- **Integrated Terminal**: Full terminal access alongside Claude conversations
- **Streaming Responses**: Real-time streaming of Claude's responses
- **Session Management**: Multiple concurrent sessions with automatic cleanup
- **Persistent Environment**: Files created by Claude persist across sessions

## Quick Start

### Prerequisites

- Docker
- Claude Code CLI credentials (`~/.claude/.credentials.json`)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd claude-code-web
   ```

2. Ensure you have valid Claude CLI credentials:
   ```bash
   # Run claude once to authenticate
   claude --version

   # Verify credentials exist
   ls ~/.claude/.credentials.json
   ```

3. Start the server:
   ```bash
   ./start.sh
   ```

4. Access the web interface:
   ```
   http://localhost:3000
   ```

### Using a Different Port

If port 3000 is already in use:
```bash
PORT=3001 ./start.sh
```

### How It Works

The start script copies your Claude credentials to a writable location (`data/claude-state/`) and mounts it into the container. This allows Claude to run with your authentication while keeping your original `~/.claude` directory unchanged.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_SESSIONS` | `5` | Maximum concurrent Claude sessions |
| `SESSION_TIMEOUT` | `3600000` | Session timeout in ms (1 hour) |
| `ANTHROPIC_API_KEY` | - | API key for Claude |

### Docker Compose

```yaml
version: '3.8'

services:
  claude-server:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ~/.claude:/root/.claude:ro
    environment:
      - PORT=3000
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    restart: unless-stopped
```

## Usage

### Web Interface

1. Open the web interface in your browser
2. Click "New Session" to start a Claude conversation
3. Type messages and receive streaming responses
4. Files created by Claude persist in the data directory

### Working Directory

Claude sessions run in a shared environment:
```
/app/data/environment/
```

Files created by Claude persist here across sessions.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main chat interface |
| GET | `/api/sessions` | List active sessions |
| POST | `/api/sessions` | Create new session |
| DELETE | `/api/sessions/:id` | Terminate session |

### WebSocket Protocol

Connect to `/ws` for real-time communication:

```javascript
// Create session
ws.send(JSON.stringify({ type: 'create_session' }));

// Send message
ws.send(JSON.stringify({ type: 'message', content: 'Hello Claude' }));

// Cancel current operation
ws.send(JSON.stringify({ type: 'cancel' }));
```

## Administration

### View Logs

```bash
docker logs -f claude-code-web-claude-server-1
```

### View Environment

```bash
ls -la data/environment/
```

### Restart Server

```bash
docker compose restart
```

## Troubleshooting

### Session not starting

- Check Claude CLI is installed: `docker exec <container> which claude`
- Verify API key is set or credentials are mounted

### Permission errors

- Ensure `~/.claude` directory exists and contains valid credentials
- Check the data directory is writable

## Development

### Local Development

```bash
npm install
node server.js
```

### Building

```bash
docker build -t claude-code-web .
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.

## License

MIT
