# Architecture

This document describes the technical architecture of Claude Code Web.

## Overview

Claude Code Web uses a hybrid architecture with two main components:

1. **Gateway Container** - Handles authentication and proxies requests
2. **Host Server** - Manages Claude sessions and terminals

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Host System                                     │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │              Gateway Container (claude-code-gateway)                    │ │
│  │                        Ubuntu 24.04 / Port 3000                         │ │
│  │  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────┐  │ │
│  │  │   Browser    │──▶│  PAM Auth    │──▶│   HTTP/WebSocket          │  │ │
│  │  │   Client     │   │  (Python)    │   │   Proxy                   │──┼─┼─┐
│  │  │              │   │              │   │                           │  │ │ │
│  │  │   HTTP/WS    │   │  /etc/passwd │   │   http-proxy              │  │ │ │
│  │  │   :3000      │◀──│  /etc/shadow │◀──│   -> 172.17.0.1:3001      │  │ │ │
│  │  └──────────────┘   └──────────────┘   └───────────────────────────┘  │ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │ │
│                                                                             │ │
│  ┌────────────────────────────────────────────────────────────────────────┐ │ │
│  │                    Host Server (Node.js)                                │◀┘ │
│  │                          Port 3001                                      │   │
│  │  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────┐  │   │
│  │  │   Session    │   │   Claude     │   │   Terminal Manager        │  │   │
│  │  │   Manager    │   │   Process    │   │   (node-pty)              │  │   │
│  │  │              │   │              │   │                           │  │   │
│  │  │   Sessions   │   │   CLI spawn  │   │   PTY terminals           │  │   │
│  │  │   History    │   │   stream-json│   │   Starship prompt         │  │   │
│  │  └──────────────┘   └──────────────┘   └───────────────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Gateway Server (`gateway.js`)

The gateway runs in a Docker container (Ubuntu 24.04) and handles:

- **PAM Authentication**: Verifies credentials against `/etc/passwd` and `/etc/shadow`
- **Session Management**: Issues signed JWT-like session cookies (24-hour expiry)
- **HTTP Proxy**: Forwards API requests to host server
- **WebSocket Proxy**: Forwards WebSocket connections to host server

**Key Features:**
- Ubuntu 24.04 base image for yescrypt password hash support
- Python's crypt module for password verification
- URL-decoding of session cookies for WebSocket auth
- Re-attaches request body for POST proxying (after express.json() consumes it)

**Environment Variables:**
- `HOST_SERVER_IP` - Host server IP (default: `host.docker.internal` or `172.17.0.1`)
- `HOST_SERVER_PORT` - Host server port (default: `3001`)
- `SESSION_SECRET` - Secret for signing session cookies

### 2. PAM Auth (`src/pam-auth.js`)

System authentication module:

- Reads `/etc/passwd` for user info (UID, GID, home directory)
- Reads `/etc/shadow` for password hashes
- Uses Python's `crypt` module for password verification
- Supports multiple hash algorithms:
  - `$y$` - yescrypt (modern default on Arch, Debian, Ubuntu)
  - `$6$` - SHA-512
  - `$5$` - SHA-256
  - `$1$` - MD5 (legacy)

**Password Verification:**
```python
import crypt
generated = crypt.crypt(password, stored_hash)
if generated == stored_hash:
    # Password matches
```

### 3. Host Server Manager (`src/host-server-manager.js`)

Manages connection to the host server:

- Configures host server IP and port
- Health check endpoint verification
- Provides proxy target for gateway

### 4. Host Server (`server.js`)

Express.js application running on the host machine:

- Serves static files (HTML, CSS, JS)
- Handles HTTP API endpoints
- Manages WebSocket connections
- Runs in single-user mode (authentication handled by gateway)

**Key Routes:**
- `GET /` - Main chat interface
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `DELETE /api/sessions/:id` - Terminate session
- `GET /api/health` - Health check

### 5. Session Manager (`src/session-manager.js`)

Manages Claude CLI sessions:

```javascript
{
  sessions: Map<sessionId, {
    id: string,
    process: ClaudeProcess,
    history: Array,
    createdAt: number,
    lastActivity: number,
    workingDirectory: string
  }>
}
```

**Session Lifecycle:**
1. Create session with working directory
2. Spawn Claude process
3. Track message history
4. Clean up expired sessions
5. Terminate on disconnect or manual close

### 6. Claude Process (`src/claude-process.js`)

Wraps the Claude CLI as a child process:

```javascript
spawn('claude', ['--output-format', 'stream-json', '--verbose'], {
  cwd: workingDirectory,
  env: {
    HOME: workingDirectory,
    TERM: 'dumb',
    CI: 'true'
  }
});
```

**Event Types Emitted:**
- `chunk` - Streaming text content
- `content_start/stop` - Content block boundaries
- `tool_input_delta` - Tool use streaming
- `complete` - Message complete
- `error` - Error occurred
- `cancelled` - Operation cancelled

### 7. Terminal Manager (`src/terminal-manager.js`)

PTY terminal management using node-pty:

- Creates pseudo-terminals with bash shell
- Handles terminal input/output streaming
- Supports terminal resize operations
- Starship prompt integration
- Cleans up terminals on disconnect

### 8. WebSocket Handler (`src/websocket.js`)

Real-time communication layer:

```
Browser Client            Gateway              Host Server
      │                      │                      │
      │──── WS connect ─────▶│──── WS proxy ───────▶│
      │◀─── connected ───────│◀────────────────────│
      │                      │                      │
      │──── create_session ─▶│─────────────────────▶│
      │◀─── session_created ─│◀────────────────────│
      │                      │                      │
      │──── message ────────▶│─────────────────────▶│
      │◀─── chunk ───────────│◀────────────────────│
      │◀─── complete ────────│◀────────────────────│
```

**Message Types:**

| Client → Server | Description |
|-----------------|-------------|
| `create_session` | Create new Claude session |
| `join_session` | Join existing session |
| `message` | Send message to Claude |
| `cancel` | Cancel current operation |
| `list_sessions` | List all sessions |
| `terminal_create` | Create new PTY terminal |
| `terminal_input` | Send input to terminal |
| `terminal_resize` | Resize terminal |
| `terminal_close` | Close terminal |

| Server → Client | Description |
|-----------------|-------------|
| `connected` | Connection established |
| `session_created` | Session ready |
| `session_joined` | Joined with history |
| `chunk` | Streaming text |
| `content_start/stop` | Content boundaries |
| `complete` | Response complete |
| `error` | Error occurred |
| `terminal_created` | Terminal ready with ID |
| `terminal_output` | Terminal output data |
| `terminal_closed` | Terminal closed |

## Data Flow

### Authentication Flow

```
Browser                  Gateway                   Host
   │                        │                        │
   │── GET /login ─────────▶│                        │
   │◀── login.html ─────────│                        │
   │                        │                        │
   │── POST /api/login ────▶│                        │
   │                        │── Read /etc/passwd ───▶│
   │                        │── Read /etc/shadow ───▶│
   │                        │── Python crypt ───────▶│
   │                        │◀── match/nomatch ─────│
   │                        │                        │
   │                        │── Check host server ──▶│
   │                        │◀── health OK ─────────│
   │                        │                        │
   │◀── Set session cookie ─│                        │
   │◀── { success: true } ──│                        │
```

### Session Creation Flow

```
Browser                  Gateway                   Host Server
   │                        │                        │
   │── WS /ws ─────────────▶│── WS proxy ───────────▶│
   │   (session cookie)     │   (verify cookie)      │
   │◀── connected ──────────│◀──────────────────────│
   │                        │                        │
   │── create_session ─────▶│─────────────────────▶│
   │                        │                        │── Spawn Claude CLI
   │                        │                        │── Track session
   │◀── session_created ────│◀──────────────────────│
```

### Message Processing Flow

```
User Input
    │
    ▼
┌──────────────────┐
│  WebSocket       │
│  (via Gateway)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Host Server     │
│  handleMessage() │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Claude Process  │
│  process.stdin   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Claude CLI      │
│  (stream-json)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  process.stdout  │
│  Parse JSON      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  WebSocket       │
│  (via Gateway)   │
└────────┬─────────┘
         │
         ▼
    Browser UI
```

## File Structure

```
claude-code-web/
├── gateway.js                # Gateway server (runs in Docker)
├── server.js                 # Host server (runs on host)
├── package.json
├── Dockerfile.gateway        # Gateway container image (Ubuntu 24.04)
├── start.sh                  # Start script
├── stop.sh                   # Stop script
├── public/
│   ├── index.html           # Main chat interface
│   ├── login.html           # Login page
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js           # Main application logic
│       ├── chat.js          # Chat functionality
│       ├── terminal.js      # Terminal integration
│       ├── websocket.js     # WebSocket client
│       ├── markdown.js      # Markdown rendering
│       └── login.js         # Login page logic
├── src/
│   ├── pam-auth.js          # PAM authentication (Python crypt)
│   ├── host-server-manager.js # Host server connection
│   ├── session-manager.js   # Claude session management
│   ├── terminal-manager.js  # PTY terminal management
│   ├── claude-process.js    # Claude CLI wrapper
│   └── websocket.js         # WebSocket handler
└── data/                    # Runtime data
    ├── server.log           # Host server logs
    └── server.pid           # Host server PID
```

## Docker Configuration

### Gateway Container

The gateway container needs:

1. **Host auth files**: `/etc/passwd`, `/etc/shadow`, `/etc/group` (read-only)
2. **Session secret**: For cookie signing
3. **Host server access**: Network connectivity to host

```bash
docker run -d \
    --name claude-code-gateway \
    -p 3000:3000 \
    -e HOST_SERVER_IP=172.17.0.1 \
    -e HOST_SERVER_PORT=3001 \
    -e SESSION_SECRET="..." \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/shadow:/etc/shadow:ro \
    -v /etc/group:/etc/group:ro \
    --add-host=host.docker.internal:host-gateway \
    claude-code-gateway
```

### Gateway Dockerfile

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    whois \
    curl \
    python3 \
    nodejs \
    npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ... install dependencies and copy files
```

**Why Ubuntu 24.04?**
- Native yescrypt support in glibc
- Python's crypt module works with all hash types
- Modern package versions

## Dependencies

| Package | Purpose | Used In |
|---------|---------|---------|
| `express` | HTTP server framework | Gateway, Host |
| `ws` | WebSocket server | Host |
| `cookie-parser` | Session cookie parsing | Gateway, Host |
| `uuid` | Generate unique session IDs | Host |
| `node-pty` | Terminal emulation | Host |
| `http-proxy` | Proxy requests/websockets | Gateway |

## Security Considerations

1. **Authentication**: PAM auth via mounted `/etc/shadow` (read-only)
2. **Session Cookies**: Signed with HMAC-SHA256, 24-hour expiry
3. **URL Decoding**: Session tokens URL-decoded to handle browser encoding
4. **Host Isolation**: Gateway runs in container, sessions run on host
5. **No Docker Socket**: Gateway doesn't need Docker socket access
