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
│  │  │   Sessions   │   │   query()    │   │   PTY terminals           │  │   │
│  │  │   History    │   │   canUseTool │   │   Starship prompt         │  │   │
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

Manages Claude sessions with SQLite persistence:

```javascript
{
  sessions: Map<sessionId, {
    id: string,
    name: string,
    process: ClaudeProcess,
    history: Array,
    createdAt: number,
    lastActivity: number,
    workingDirectory: string,
    mode: 'default' | 'acceptEdits' | 'plan',
    persisted: boolean  // true if loaded from database
  }>
}
```

**Configuration:**

- `MAX_SESSIONS` - Maximum concurrent sessions (default: 5)
- `SESSION_TIMEOUT` - Session timeout in ms (default: 3600000 = 1 hour)

**Session Lifecycle:**

1. Load persisted sessions from SQLite on startup
2. Create session with working directory and name
3. Spawn Claude process via SDK
4. Track message history (persisted to database)
5. Sessions can be renamed
6. Mode can be changed (default/acceptEdits/plan)
7. Clean up expired sessions automatically
8. Terminate on disconnect or manual close
9. Sessions recover when user rejoins (if persisted)

### 5.1 Session Database (`src/database.js`)

SQLite persistence layer using better-sqlite3:

**Tables:**

- `sessions` - Session metadata (id, name, working_directory, mode, timestamps, is_active)
- `messages` - Message history (session_id, role, content, timestamp)

**Features:**

- WAL mode for better concurrent access
- Periodic WAL checkpoints (every 5 minutes)
- Automatic cleanup of expired sessions
- Foreign key constraints for data integrity

### 6. Claude Process (`src/claude-process.js`)

Wraps the Claude Agent SDK for AI interactions:

```javascript
const { query } = require('@anthropic-ai/claude-agent-sdk');

queryInstance = query({
  prompt: messageGenerator, // Async generator for streaming input
  options: {
    cwd: workingDirectory,
    permissionMode: 'default',
    canUseTool: async (toolName, input, options) => {
      // Handle permission request - must return { behavior: 'allow' | 'deny' }
      // Implements mode-based auto-approval:
      // - Plan mode: only allow read-only tools
      // - Accept Edits mode: auto-approve file edits
      // - Default mode: prompt user for permission
    },
  },
});
```

**Operating Modes:**

- `default` - Normal operation with permission prompts
- `acceptEdits` - Auto-approve Edit, Write, MultiEdit, NotebookEdit
- `plan` - Read-only mode (only allows Glob, Grep, Read, WebFetch, WebSearch, Task, TodoWrite)

**Event Types Emitted:**

- `chunk` - Streaming text content
- `content_start/stop` - Content block boundaries
- `tool_input_delta` - Tool use streaming
- `tool_use` - Tool being executed (with agentId for nested agents)
- `complete` - Message complete
- `result` - Final result
- `error` - Error occurred
- `cancelled` - Operation cancelled
- `permission_request` - Tool needs user approval
- `prompt` - AskUserQuestion from Claude
- `agent_start` - New agent task started
- `task_notification` - Background task completed
- `exit_plan_mode_request` - Plan mode exit requested

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

| Client → Server           | Description                                             |
| ------------------------- | ------------------------------------------------------- |
| `create_session`          | Create new Claude session (with workingDirectory, name) |
| `join_session`            | Join existing session                                   |
| `message`                 | Send message to Claude                                  |
| `cancel`                  | Cancel current operation                                |
| `list_sessions`           | List all sessions                                       |
| `rename_session`          | Rename a session                                        |
| `list_agents`             | List active agents                                      |
| `set_mode`                | Change mode (default/acceptEdits/plan)                  |
| `prompt_response`         | Respond to AskUserQuestion                              |
| `permission_response`     | Respond to tool permission request                      |
| `exit_plan_mode_response` | Approve/deny exiting plan mode                          |
| `terminal_create`         | Create new PTY terminal                                 |
| `terminal_input`          | Send input to terminal                                  |
| `terminal_resize`         | Resize terminal                                         |
| `terminal_close`          | Close terminal                                          |

| Server → Client          | Description                        |
| ------------------------ | ---------------------------------- |
| `connected`              | Connection established             |
| `session_created`        | Session ready                      |
| `session_joined`         | Joined with history (and mode)     |
| `session_renamed`        | Session name changed               |
| `sessions_list`          | List of all sessions               |
| `message_sent`           | Message sent to Claude             |
| `chunk`                  | Streaming text                     |
| `content_start/stop`     | Content boundaries                 |
| `tool_use`               | Tool being executed (with agentId) |
| `complete`               | Response complete                  |
| `result`                 | Final result                       |
| `error`                  | Error occurred                     |
| `cancelled`              | Operation cancelled                |
| `permission_request`     | Tool needs user approval           |
| `prompt`                 | AskUserQuestion from Claude        |
| `mode_changed`           | Operating mode changed             |
| `agent_start`            | New agent task started             |
| `task_notification`      | Background task completed          |
| `agents_list`            | List of active agents              |
| `exit_plan_mode_request` | Plan mode exit requested           |
| `terminal_created`       | Terminal ready with ID             |
| `terminal_data`          | Terminal output data               |
| `terminal_exit`          | Terminal closed                    |

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
│   ├── claude-process.js    # Claude Agent SDK wrapper
│   ├── websocket.js         # WebSocket handler
│   ├── database.js          # SQLite session persistence
│   ├── environment-manager.js # User environment management
│   └── auth.js              # Authentication utilities
└── data/                    # Runtime data
    ├── server.log           # Host server logs
    ├── server.pid           # Host server PID
    └── sessions.db          # SQLite database for session persistence
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

| Package         | Purpose                     | Used In       |
| --------------- | --------------------------- | ------------- |
| `express`       | HTTP server framework       | Gateway, Host |
| `ws`            | WebSocket server            | Host          |
| `cookie-parser` | Session cookie parsing      | Gateway, Host |
| `uuid`          | Generate unique session IDs | Host          |
| `node-pty`      | Terminal emulation          | Host          |
| `http-proxy`    | Proxy requests/websockets   | Gateway       |

## Agent System

The Claude Process tracks background agents (sub-tasks) launched via the Task tool:

```javascript
{
  activeAgents: Map<taskId, {
    description: string,    // Short description (3-5 words)
    agentType: string,      // 'Bash', 'general-purpose', 'Explore', 'Plan', etc.
    startTime: number
  }>,
  agentContextStack: Array<taskId>  // Stack for tracking nested agents
}
```

**Agent Types:**

- `Bash` - Command execution specialist
- `general-purpose` - Multi-step tasks, code search
- `Explore` - Fast codebase exploration
- `Plan` - Implementation planning

**Events:**

- `agent_start` - Emitted when Task tool creates a new agent
- `task_notification` - Emitted when background agent completes
- `tool_use` (with `agentId`) - Tools executed by agents include their parent agent ID

## Permission System

The `canUseTool` callback in ClaudeProcess implements dynamic permission handling:

```javascript
canUseTool: async (toolName, input, options) => {
  // Plan mode: only allow read-only tools
  if (this.mode === 'plan') {
    const readOnlyTools = [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'Task',
      'TodoWrite',
      'EnterPlanMode',
    ];
    if (readOnlyTools.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: 'Plan mode: only read-only operations allowed' };
  }

  // Accept Edits mode: auto-approve file operations
  if (this.mode === 'acceptEdits') {
    const editTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    if (editTools.includes(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
  }

  // Default mode: emit permission_request and wait for user response
  return this.handlePermissionRequest(toolName, input, options);
};
```

**Special Tool Handling:**

- `AskUserQuestion` - Emits `prompt` event, waits for user answers via `prompt_response`
- `ExitPlanMode` - In plan mode, emits `exit_plan_mode_request`, requires user approval

## Security Considerations

1. **Authentication**: PAM auth via mounted `/etc/shadow` (read-only)
2. **Session Cookies**: Signed with HMAC-SHA256, 24-hour expiry
3. **URL Decoding**: Session tokens URL-decoded to handle browser encoding
4. **Host Isolation**: Gateway runs in container, sessions run on host
5. **No Docker Socket**: Gateway doesn't need Docker socket access
6. **Directory Restrictions**: `/api/directories` only allows browsing within user's home directory
