# Architecture

This document describes the technical architecture of Claude Code Web.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Container                          │
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐ │
│  │   Browser    │────▶│  Express.js  │────▶│  Claude Process  │ │
│  │   Client     │◀────│   Server     │◀────│                  │ │
│  └──────────────┘     └──────────────┘     └──────────────────┘ │
│                              │                      │            │
│                        ┌─────┴─────┐               │            │
│                        ▼           ▼               ▼            │
│                  ┌─────────────────────────────────────────┐    │
│                  │              /app/data/                  │    │
│                  │  └── environment/                        │    │
│                  │      └── (shared working directory)      │    │
│                  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Server (`server.js`)

The main Express.js application that:
- Serves static files (HTML, CSS, JS)
- Handles HTTP API endpoints
- Initializes WebSocket server
- Manages graceful shutdown

**Key Routes:**
- `GET /` - Main chat interface
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `DELETE /api/sessions/:id` - Terminate session

### 2. Environment Manager (`src/environment-manager.js`)

Manages the shared working environment:

```javascript
{
  DATA_DIR: '/app/data',
  ENVIRONMENT_DIR: '/app/data/environment'
}
```

**Responsibilities:**
- Ensures data directories exist
- Provides environment path for sessions

### 3. Session Manager (`src/session-manager.js`)

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

### 4. Claude Process (`src/claude-process.js`)

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

### 5. WebSocket Handler (`src/websocket.js`)

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
```

**Message Types:**

| Client → Server | Description |
|-----------------|-------------|
| `create_session` | Create new Claude session |
| `join_session` | Join existing session |
| `message` | Send message to Claude |
| `cancel` | Cancel current operation |
| `list_sessions` | List all sessions |

| Server → Client | Description |
|-----------------|-------------|
| `connected` | Connection established |
| `session_created` | Session ready |
| `session_joined` | Joined with history |
| `chunk` | Streaming text |
| `content_start/stop` | Content boundaries |
| `complete` | Response complete |
| `error` | Error occurred |

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
├── server.js                 # Main entry point
├── package.json
├── Dockerfile
├── docker-compose.yml
├── start.sh                  # Convenience start script
├── public/
│   ├── index.html           # Chat interface
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js           # Client-side logic
├── src/
│   ├── auth.js              # Pass-through auth middleware
│   ├── environment-manager.js # Environment management
│   ├── session-manager.js   # Session management
│   ├── claude-process.js    # Claude CLI wrapper
│   └── websocket.js         # WebSocket handler
└── data/                    # Persisted data (volume mount)
    └── environment/         # Shared working directory
```

## Docker Configuration

The container needs:
1. **Port mapping**: Expose the server port
2. **Claude credentials**: Mounted from host `~/.claude`
3. **Data persistence**: Volume for environment data

```yaml
services:
  claude-server:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ~/.claude:/root/.claude:ro
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server framework |
| `ws` | WebSocket server |
| `cookie-parser` | Parse cookies (minimal use) |
| `uuid` | Generate unique IDs |

## Environment Requirements

- Node.js 20+
- Docker
- Claude Code CLI installed globally (in container)
- Anthropic API key or valid credentials
