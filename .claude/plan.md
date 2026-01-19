# Documentation Update Plan

## Overview
This plan outlines updates needed to synchronize documentation with the current codebase. The project has evolved to include new features like persistent sessions (SQLite database), agent tracking, plan mode, and more detailed WebSocket protocol.

---

## 1. README.md Updates

### 1.1 Architecture Diagram
**Current Issue:** Diagram shows "Claude Process (CLI spawn)" but code uses Claude Agent SDK
**Update:** Change "Claude Process" to "Claude Agent SDK" and update description

### 1.2 Dependencies Table
**Current Issue:** Missing `better-sqlite3` and `zod` dependencies
**Update:** Add:
| Package | Purpose |
|---------|---------|
| `better-sqlite3` | SQLite database for session persistence |
| `zod` | Schema validation |

### 1.3 API Endpoints Table
**Current Issue:** Missing new endpoints
**Update:** Add:
- `GET /api/home` - Get user's home directory
- `GET /api/directories` - Browse directories
- `GET /api/server/status` - Server status (gateway only)

### 1.4 WebSocket Protocol Section
**Current Issue:** Missing many message types
**Update:** Add client→server types:
- `prompt_response` - Answer to AskUserQuestion
- `permission_response` - Tool permission decision
- `rename_session` - Rename a session
- `list_agents` - List active agents
- `set_mode` - Change mode (default/acceptEdits/plan)
- `exit_plan_mode_response` - Approve/deny plan mode exit

Add server→client types:
- `prompt` - Question from Claude (AskUserQuestion)
- `permission_request` - Tool needs approval
- `mode_changed` - Mode was changed
- `agent_start` - New agent started
- `task_notification` - Background task completed
- `session_renamed` - Session name changed
- `exit_plan_mode_request` - Plan mode exit requested

### 1.5 Session Management
**Current Issue:** Documentation says "Session state is in-memory only"
**Update:** Document SQLite persistence:
- Sessions persist across server restarts
- Message history is stored in SQLite database
- Sessions auto-recover when user rejoins
- Location: `data/sessions.db`

### 1.6 Operating Modes
**Current Issue:** Not documented
**Update:** Add new section:
```markdown
## Operating Modes

The web interface supports three operating modes:

- **Default Mode**: Normal operation with permission prompts for tools
- **Accept Edits Mode**: Auto-approves file edit operations (Edit, Write, MultiEdit, NotebookEdit)
- **Plan Mode**: Read-only mode for exploration and planning - only allows Glob, Grep, Read, WebFetch, WebSearch, Task, TodoWrite
```

---

## 2. ARCHITECTURE.md Updates

### 2.1 Claude Process Section (Major Update)
**Current Issue:** Shows CLI spawn with `stream-json`, but code uses SDK
**Update:** Replace with:
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

### 2.2 File Structure
**Current Issue:** Missing `database.js`, `environment-manager.js`, `auth.js`
**Update:** Add to src/ listing:
- `database.js` - SQLite session persistence (better-sqlite3)
- `environment-manager.js` - User environment management
- `auth.js` - Authentication utilities

Add to data/ listing:
- `sessions.db` - SQLite database for session persistence

### 2.3 Session Manager Section
**Current Issue:** Shows in-memory only structure
**Update:** Document SQLite persistence and session recovery

### 2.4 WebSocket Handler Section
**Current Issue:** Missing many message types
**Update:** Add all new message types listed in README.md section 1.4

### 2.5 Agent System (New Section)
**Current Issue:** Not documented
**Update:** Add new section documenting:
- Agent tracking (`activeAgents` Map)
- Agent context stack for nested agents
- `agent_start` and `task_notification` events
- Agent types: Bash, general-purpose, Explore, Plan, etc.

### 2.6 Permission System (New Section)
**Current Issue:** Not documented
**Update:** Add new section documenting:
- `canUseTool` callback pattern
- Permission request flow
- Mode-based auto-approval
- Plan mode restrictions

---

## 3. CLAUDE.md Updates

### 3.1 Architecture Diagram
**Current Issue:** Shows "Claude Agent SDK" but code pattern differs
**Update:** Update to show actual SDK usage pattern with `canUseTool`

### 3.2 WebSocket Protocol
**Current Issue:** Missing new message types
**Update:** Add:
- Client→Server: `permission_response`, `set_mode`, `exit_plan_mode_response`, `rename_session`, `list_agents`
- Server→Client: `permission_request`, `mode_changed`, `agent_start`, `task_notification`, `exit_plan_mode_request`, `session_renamed`

### 3.3 Key Modules
**Current Issue:** Missing `database.js`
**Update:** Add:
- `database.js` - SQLite persistence using better-sqlite3 (WAL mode)

### 3.4 Important Notes
**Current Issue:** Says "Session state is in-memory only"
**Update:** Change to: "Session state is persisted to SQLite database (`data/sessions.db`)"

---

## 4. Code Comments Updates

### 4.1 server.js
- Add JSDoc comments for `createSessionToken()` and `verifySessionToken()`
- Add header comment describing the file's purpose

### 4.2 gateway.js
- Add JSDoc comments for session management functions
- Document proxy configuration

### 4.3 src/claude-process.js
- Add class-level JSDoc describing ClaudeProcess
- Add method-level JSDoc for all public methods
- Document event types emitted

### 4.4 src/session-manager.js
- Add class-level JSDoc describing SessionManager
- Add JSDoc for configuration constants (MAX_SESSIONS, SESSION_TIMEOUT)
- Document database integration

### 4.5 src/database.js
- Add module-level JSDoc describing database schema
- Document WAL mode usage

### 4.6 src/websocket.js
- Add function-level JSDoc for message handlers
- Document message type schemas

### 4.7 src/terminal-manager.js
- Add class-level JSDoc for TerminalManager and TerminalSession
- Document cleanup behavior

---

## Summary of Changes

| File | Type of Update |
|------|----------------|
| README.md | Architecture, API endpoints, WebSocket protocol, persistence docs, modes |
| ARCHITECTURE.md | SDK integration, file structure, new sections (agents, permissions) |
| CLAUDE.md | Architecture, WebSocket protocol, modules, persistence |
| server.js | JSDoc comments |
| gateway.js | JSDoc comments |
| src/claude-process.js | JSDoc comments |
| src/session-manager.js | JSDoc comments |
| src/database.js | JSDoc comments |
| src/websocket.js | JSDoc comments |
| src/terminal-manager.js | JSDoc comments |

---

## Implementation Order

1. **README.md** - Primary user-facing documentation
2. **ARCHITECTURE.md** - Technical reference
3. **CLAUDE.md** - Developer/Claude guidance
4. **Source code comments** - Code-level documentation (all source files)
