# Plan: Remove Command-Related Functionality

## Overview
Remove all slash command handling, autocomplete, and related functionality from the Claude Code Web project. This includes client-side command routing, server-side command handling, and the autocomplete UI.

## Files to Modify

### 1. Delete Files
- `public/js/command-handler.js` - Command parsing and routing logic
- `public/js/slash-commands.js` - Autocomplete UI for slash commands

### 2. Modify `public/index.html`
Remove script includes for command files:
```html
<!-- Remove these lines -->
<script src="/js/command-handler.js"></script>
<script src="/js/slash-commands.js"></script>
```

### 3. Modify `public/js/app.js`
- Remove `this.commandHandler = new CommandHandler();` (line 16)
- Remove `initSlashAutocomplete()` method (lines 100-109)
- Remove `handleSlashCommand()` method (lines 111-116)
- Remove slash command autocomplete initialization call in `init()` (line 91)
- Remove autocomplete-related event handling in `setupEventListeners()` (lines 124-132)
- Simplify `sendMessage()` method to remove command routing logic (lines 530-561)
- Remove `onServerStatus()` handler (lines 1295-1297)
- Remove `onCommandResponse()` handler (lines 1299-1307)
- Remove event listeners for `server_status` and `command_response` (lines 311-312)

### 4. Modify `public/js/websocket.js`
- Remove `sendCommand()` method (lines 304-310)
- Remove `sendServerCommand()` method (lines 317-322)
- Remove `server_status` case in `handleMessage()` (lines 224-229)
- Remove `command_response` case in `handleMessage()` (lines 231-237)

### 5. Modify `src/websocket.js` (server-side)
- Remove `case 'command':` handling (lines 203-205)
- Remove `case 'server_command':` handling (lines 207-209)
- Remove `handleClaudeCommand()` function (lines 845-878)
- Remove `handleServerCommand()` function (lines 883-908)

### 6. Modify `public/css/style.css`
Remove slash autocomplete styles (lines 1808-1907):
- `.slash-autocomplete` and related styles
- `.slash-autocomplete-item` styles
- `.slash-command-name` and `.slash-command-desc` styles
- Related media queries and scrollbar styles

## Summary of Changes

| File | Action |
|------|--------|
| `public/js/command-handler.js` | DELETE |
| `public/js/slash-commands.js` | DELETE |
| `public/index.html` | Remove 2 script tags |
| `public/js/app.js` | Remove command handler, autocomplete, and simplify sendMessage |
| `public/js/websocket.js` | Remove sendCommand, sendServerCommand, and related handlers |
| `src/websocket.js` | Remove command and server_command handlers |
| `public/css/style.css` | Remove ~100 lines of slash autocomplete styles |

## Behavior After Changes
- Messages starting with `/` will be sent as regular messages to Claude (no special handling)
- No autocomplete dropdown when typing `/`
- No client-side command execution (like `/clear`)
- No server-side command execution (like `/status`)
- All input treated uniformly as messages to Claude
