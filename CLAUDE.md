# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Code Web is a browser-based interface for Claude Code CLI. It uses a hybrid architecture:
- **Gateway (Docker, port 3000)**: PAM authentication via `/etc/passwd` and `/etc/shadow`, proxies to host server
- **Host Server (Node.js, port 3001)**: Manages Claude sessions via Claude Agent SDK and PTY terminals

## Commands

```bash
# Start everything (gateway + host server)
./start.sh

# Stop everything
./stop.sh

# Start with custom ports
GATEWAY_PORT=8080 HOST_PORT=8081 ./start.sh

# Development - Host server only (single-user mode, no auth)
PORT=3001 SINGLE_USER_MODE=true node server.js

# View logs
docker logs -f claude-code-gateway    # Gateway logs
tail -f ./data/server.log             # Host server logs

# Health checks
curl http://localhost:3000/health     # Gateway
curl http://localhost:3001/api/health # Host server
```

## Architecture

```
Browser -> Gateway (Docker:3000) -> Host Server (Node.js:3001)
                |                         |
           PAM auth via             Claude Agent SDK
           Python crypt             + node-pty terminals
```

**Key modules in `src/`:**
- `pam-auth.js` - PAM authentication using Python's crypt module (supports yescrypt, SHA-512, SHA-256, MD5)
- `claude-process.js` - Wraps Claude Agent SDK `query()` for streaming responses
- `session-manager.js` - Session lifecycle (max 5 concurrent, 1-hour timeout)
- `terminal-manager.js` - PTY terminal management via node-pty
- `websocket.js` - Real-time bidirectional communication

**Frontend in `public/`:**
- `index.html` / `login.html` - Main pages
- `js/app.js` - Application orchestration
- `js/chat.js` - Chat UI
- `js/terminal.js` - Terminal UI (xterm.js)
- `js/websocket.js` - WebSocket client

## WebSocket Protocol

Client -> Server message types:
- `create_session`, `join_session`, `message`, `cancel`
- `prompt_response` - Respond to tool permission requests
- `terminal_create`, `terminal_input`, `terminal_resize`, `terminal_close`

Server -> Client events:
- `connected`, `session_created`, `chunk`, `complete`
- `permission_request` - Tool execution approval needed
- `terminal_created`, `terminal_output`

## Claude Agent SDK Integration

The project uses `@anthropic-ai/claude-agent-sdk` (not CLI spawning). Key pattern in `claude-process.js`:

```javascript
const { query } = require('@anthropic-ai/claude-agent-sdk');

queryInstance = query({
  prompt: messageGenerator,  // Async generator for streaming input
  options: {
    cwd: workingDirectory,
    permissionMode: 'default',
    canUseTool: async (toolName, input, options) => {
      // Handle permission request - must return { behavior: 'allow' | 'deny' }
    }
  }
});
```

## Important Notes

- **Ubuntu 24.04 required** for gateway Docker image (yescrypt password hash support)
- **Node.js 20+ required** on host
- Session state is in-memory only (lost on server restart)
- No automated test suite exists
- Docker network: Gateway connects to host via `172.17.0.1` (Linux) or `host.docker.internal` (macOS/Windows)
