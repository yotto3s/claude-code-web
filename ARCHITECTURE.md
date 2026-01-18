# Architecture

This document describes the technical architecture of Claude Code Web.

## Deployment Modes

Claude Code Web supports two deployment modes:

### 1. Gateway Mode (Multi-user)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Host System                                     │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                 Gateway Container (claude-code-gateway)                 │ │
│  │  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────────┐  │ │
│  │  │   Browser    │──▶│  PAM Auth    │──▶│   Container Manager       │  │ │
│  │  │   Client     │   │  (system)    │   │   (per-user containers)   │  │ │
│  │  │              │   │              │   │                           │  │ │
│  │  │   HTTP/WS    │   │  /etc/passwd │   │   docker run              │  │ │
│  │  │   Proxy      │◀──│  /etc/shadow │◀──│   claude-user-<username>  │  │ │
│  │  └──────────────┘   └──────────────┘   └───────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│         ┌──────────────────────────┼───────────────────────────┐            │
│         ▼                          ▼                           ▼            │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  User Container │    │  User Container │    │  User Container │         │
│  │  claude-user-   │    │  claude-user-   │    │  claude-user-   │         │
│  │  alice          │    │  bob            │    │  carol          │         │
│  │  (uid: 1000)    │    │  (uid: 1001)    │    │  (uid: 1002)    │         │
│  │  /home/alice    │    │  /home/bob      │    │  /home/carol    │         │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │         │
│  │  │Claude CLI │  │    │  │Claude CLI │  │    │  │Claude CLI │  │         │
│  │  │node-pty   │  │    │  │node-pty   │  │    │  │node-pty   │  │         │
│  │  │Starship   │  │    │  │Starship   │  │    │  │Starship   │  │         │
│  │  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Gateway runs in Docker container (accesses Docker socket to spawn user containers)
- Authenticates against system PAM (/etc/passwd, /etc/shadow)
- Supports yescrypt ($y$), SHA-512 ($6$), SHA-256 ($5$), MD5 ($1$) password hashes
- Spawns isolated Docker containers per user on `claude-code-network`
- Each container runs with user's UID/GID via docker-entrypoint.sh
- User's home directory mounted read-write
- HTTP and WebSocket connections proxied via http-proxy
- Complete isolation between users

## Components

### Gateway Mode Components

#### 1. Gateway Server (`gateway.js`)

The main entry point for multi-user deployment, running in the `claude-code-gateway` container:
- Handles PAM authentication against host system via mounted `/etc/passwd` and `/etc/shadow`
- Manages user sessions with signed cookies (24-hour expiry)
- Spawns per-user Docker containers via Docker socket
- Proxies HTTP and WebSocket connections to user containers using `http-proxy`
- Connects all containers via `claude-code-network` Docker network

**Key Routes:**
- `GET /login` - Login page
- `POST /api/login` - Authenticate, start container, set session cookie
- `POST /api/logout` - End session (optionally stop container)
- `GET /api/container/status` - Check if user's container is running
- All other routes proxied to user's container by IP address

#### 2. PAM Auth (`src/pam-auth.js`)

System authentication module using host-mounted files:
- Reads `/etc/passwd` for user info (UID, GID, home directory)
- Reads `/etc/shadow` for password hashes
- Uses `mkpasswd` (from `whois` package) for password verification
- Supports multiple hash algorithms:
  - `$y$` - yescrypt (modern default on Debian/Ubuntu)
  - `$6$` - SHA-512
  - `$5$` - SHA-256
  - `$1$` - MD5 (legacy)

#### 3. Container Manager (`src/container-manager.js`)

Manages per-user Docker containers:
- Creates containers named `claude-user-<username>`
- Runs containers with correct UID/GID: `--user <uid>:<gid>`
- Mounts user's home directory: `-v <home>:<home>`
- Connects to `claude-code-network` for gateway communication
- Tracks running containers by IP address
- Handles container lifecycle (start, stop, status)

**Container startup command:**
```bash
docker run -d --init \
    --name claude-user-<username> \
    --network claude-code-network \
    --user <uid>:<gid> \
    -e USER=<username> \
    -e HOME=<home> \
    -v <home>:<home> \
    claude-code-user
```

### User Container Components (Dockerfile.user)

The per-user container includes:
- **Node.js 20** - Runtime environment
- **Claude Code CLI** - Installed globally via npm
- **node-pty** - Terminal emulation for integrated shell
- **Starship** - Beautiful shell prompt
- **docker-entrypoint.sh** - Maps UID/GID to proper username in `/etc/passwd`

### User Container Server (`server.js`)

The Express.js application running inside each user container:
- Serves static files (HTML, CSS, JS)
- Handles HTTP API endpoints
- Initializes WebSocket server
- Runs in `SINGLE_USER_MODE=true` (authentication handled by gateway)

**Key Routes:**
- `GET /` - Main chat interface
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `DELETE /api/sessions/:id` - Terminate session

### Environment Manager (`src/environment-manager.js`)

Manages the working environment for Claude sessions:

**Responsibilities:**
- Ensures data directories exist
- Provides environment path for sessions (user's home directory)

### Session Manager (`src/session-manager.js`)

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
4. Clean up expired sessions (configurable timeout)
5. Terminate on disconnect or manual close

### Claude Process (`src/claude-process.js`)

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

### WebSocket Handler (`src/websocket.js`)

Real-time communication layer:

```
Browser Client            Server
      │                      │
      │──── connect ────────▶│
      │◀─── connected ───────│
      │                      │
      │──── create_session ─▶│
      │◀─── session_created ─│
      │                      │
      │──── message ────────▶│
      │◀─── chunk ───────────│
      │◀─── chunk ───────────│
      │◀─── complete ────────│
      │                      │
      │──── terminal_create ▶│
      │◀─── terminal_created │
      │                      │
      │──── terminal_input ─▶│
      │◀─── terminal_output ─│
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

### 6. Terminal Manager (`src/terminal-manager.js`)

PTY terminal management using node-pty:
- Creates pseudo-terminals with bash shell
- Handles terminal input/output streaming
- Supports terminal resize operations
- Cleans up terminals on disconnect

## Data Flow

### Session Creation

```
WebSocket Connect
         │
         ▼
┌─────────────────────┐
│  Send 'connected'   │
└──────────┬──────────┘
           │
           ▼
   Client sends 'create_session'
           │
           ▼
┌─────────────────────┐
│  environmentManager │
│  .ensureEnvironment │
│                     │
│  Returns shared     │
│  environment path   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  sessionManager     │
│  .createSession     │
│                     │
│  1. Spawn Claude    │
│  2. Track session   │
└──────────┬──────────┘
           │
           ▼
   Send 'session_created'
```

### Message Processing

```
User Input
    │
    ▼
┌──────────────────┐
│  WebSocket       │
│  (ws.send)       │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  handleMessage() │
│  Verify session  │
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
│  Event Emitter   │
│  (chunk, etc)    │
└────────┬─────────┘
         │
         ▼
    Browser UI
```

## File Structure

```
claude-code-web/
├── gateway.js                # Gateway server entry point
├── server.js                 # User container server entry point
├── package.json
├── Dockerfile.gateway        # Gateway container image
├── Dockerfile.user           # Per-user container image
├── docker-compose.yml        # Docker compose configuration
├── docker-entrypoint.sh      # User container entrypoint
├── start-gateway.sh          # Start script (builds and runs)
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
│   ├── auth.js              # Auth middleware
│   ├── pam-auth.js          # PAM authentication
│   ├── container-manager.js # User container management
│   ├── environment-manager.js # Environment management
│   ├── session-manager.js   # Claude session management
│   ├── terminal-manager.js  # PTY terminal management
│   ├── claude-process.js    # Claude CLI wrapper
│   └── websocket.js         # WebSocket handler
└── data/                    # Persisted data (volume mount)
    ├── environments/        # Per-user environments
    └── claude-state/        # Claude CLI state
```

## Docker Configuration

The gateway container needs:
1. **Docker socket**: To spawn user containers
2. **Host auth files**: `/etc/passwd`, `/etc/shadow`, `/etc/group`
3. **Home directories**: `/home` mount for user access
4. **Session secret**: For cookie signing

```bash
docker run -it --rm --init \
    --name claude-code-gateway \
    --network claude-code-network \
    -p 3000:3000 \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/shadow:/etc/shadow:ro \
    -v /etc/group:/etc/group:ro \
    -v /home:/home \
    -e SESSION_SECRET="..." \
    claude-code-gateway
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `ws` | WebSocket server |
| `cookie-parser` | Session cookie parsing |
| `uuid` | Generate unique session IDs |
| `node-pty` | Terminal emulation (user containers) |
| `http-proxy` | Proxy requests to user containers (gateway) |

## Environment Requirements

### Gateway Container
- Docker with socket access
- Host system with PAM authentication
- Users with valid credentials in `/etc/passwd` and `/etc/shadow`
- User home directories accessible

### User Containers
- Claude Code CLI (installed in container image)
- User's Claude credentials in `~/.claude/.credentials.json`
- node-pty for terminal emulation
