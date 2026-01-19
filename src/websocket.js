const WebSocket = require('ws');
const { sessionManager } = require('./session-manager');
const { environmentManager } = require('./environment-manager');
const { terminalManager } = require('./terminal-manager');

// Parse cookies from header
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  });
  return cookies;
}

// Safely send a message, checking if WebSocket is still open
function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  }
  return false;
}

// Check if WebSocket is still connected
function isWsOpen(ws) {
  return ws.readyState === WebSocket.OPEN;
}

function setupWebSocket(server) {
  // Import auth functions from server.js (they're exported)
  const { verifySessionToken, USERS, SINGLE_USER_MODE } = require('../server');

  const wss = new WebSocket.Server({
    server,
    path: '/ws'
  });

  wss.on('connection', async (ws, req) => {
    const clientIP = getClientIP(req);

    // Validate auth if users are configured (not single-user mode)
    if (!SINGLE_USER_MODE && USERS.size > 0) {
      const cookies = parseCookies(req.headers.cookie);
      console.log(`WebSocket cookie header: ${req.headers.cookie || '(none)'}`);
      const username = verifySessionToken(cookies.session);
      if (!username) {
        console.log(`WebSocket auth failed from ${clientIP} - no valid session token`);
        ws.close(4001, 'Unauthorized');
        return;
      }
      ws.username = username;
      console.log(`WebSocket connected from ${clientIP} (user: ${username})`);
    } else {
      ws.username = process.env.USER || 'default';
      console.log(`WebSocket connected from ${clientIP} (single-user mode)`);
    }

    // Session state for this connection
    let currentSession = null;

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleMessage(ws, msg, { getCurrentSession: () => currentSession, setSession });
      } catch (err) {
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      console.log(`WebSocket disconnected from ${clientIP}`);
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
    });

    function setSession(session) {
      currentSession = session;
    }

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'connected'
    }));
  });

  return wss;
}

async function handleMessage(ws, msg, ctx) {
  const { getCurrentSession, setSession } = ctx;

  switch (msg.type) {
    case 'create_session':
      handleCreateSession(ws, msg, setSession);
      break;

    case 'join_session':
      handleJoinSession(ws, msg, setSession);
      break;

    case 'message':
      handleUserMessage(ws, msg, getCurrentSession);
      break;

    case 'cancel':
      handleCancel(ws, getCurrentSession);
      break;

    case 'prompt_response':
      handlePromptResponse(ws, msg, getCurrentSession);
      break;

    case 'permission_response':
      handlePermissionResponse(ws, msg, getCurrentSession);
      break;

    case 'list_sessions':
      handleListSessions(ws);
      break;

    case 'rename_session':
      handleRenameSession(ws, msg, getCurrentSession);
      break;

    case 'list_agents':
      handleListAgents(ws, msg, getCurrentSession);
      break;

    case 'terminal_create':
      handleTerminalCreate(ws, msg, getCurrentSession);
      break;

    case 'terminal_input':
      handleTerminalInput(ws, msg);
      break;

    case 'terminal_resize':
      handleTerminalResize(ws, msg);
      break;

    case 'terminal_close':
      handleTerminalClose(ws, msg);
      break;

    case 'set_mode':
      handleSetMode(ws, msg, getCurrentSession);
      break;

    default:
      sendError(ws, `Unknown message type: ${msg.type}`);
  }
}

function handleCreateSession(ws, msg, setSession) {
  try {
    let workingDirectory;

    // Use client-provided directory if valid, otherwise use default
    if (msg.workingDirectory && typeof msg.workingDirectory === 'string') {
      const fs = require('fs');
      const path = require('path');

      // Resolve and validate the path
      const resolvedPath = path.resolve(msg.workingDirectory);

      // Check if directory exists
      if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
        workingDirectory = resolvedPath;
      } else {
        sendError(ws, `Directory does not exist: ${msg.workingDirectory}`);
        return;
      }
    } else {
      // Use shared environment for single-user mode
      const envInfo = environmentManager.ensureEnvironment();
      workingDirectory = envInfo.path;
    }

    const sessionName = msg.name || null;
    const session = sessionManager.createSession(workingDirectory, sessionName);
    setSession(session);

    setupSessionListeners(ws, session);

    safeSend(ws, {
      type: 'session_created',
      session: {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        workingDirectory: session.workingDirectory
      }
    });
  } catch (err) {
    sendError(ws, err.message);
  }
}

function handleJoinSession(ws, msg, setSession) {
  let session = sessionManager.getSession(msg.sessionId);

  if (!session) {
    sendError(ws, 'Session not found');
    return;
  }

  // Recover session if it doesn't have an active process (was persisted)
  if (!session.process) {
    session = sessionManager.recoverSession(msg.sessionId);
    if (!session) {
      sendError(ws, 'Failed to recover session');
      return;
    }
    console.log(`Recovered persisted session ${session.id}`);
  }

  setSession(session);
  setupSessionListeners(ws, session);

  // Send session info and history
  safeSend(ws, {
    type: 'session_joined',
    session: {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      workingDirectory: session.workingDirectory,
      mode: session.mode || 'default',
      recovered: session.persisted || false // Let client know this was recovered
    },
    history: session.history
  });
}

function handleRenameSession(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  if (!msg.name || typeof msg.name !== 'string') {
    sendError(ws, 'Session name is required');
    return;
  }

  const newName = msg.name.trim().substring(0, 100); // Limit to 100 chars
  const success = sessionManager.renameSession(session.id, newName);

  if (success) {
    safeSend(ws, {
      type: 'session_renamed',
      sessionId: session.id,
      name: newName
    });
  } else {
    sendError(ws, 'Failed to rename session');
  }
}

function setupSessionListeners(ws, session) {
  const proc = session.process;

  // Remove any existing listeners to prevent duplicates
  proc.removeAllListeners();

  proc.on('chunk', (data) => {
    safeSend(ws, {
      type: 'chunk',
      text: data.text,
      index: data.index
    });
  });

  proc.on('content_start', (data) => {
    safeSend(ws, {
      type: 'content_start',
      contentBlock: data.contentBlock,
      index: data.index
    });
  });

  proc.on('content_stop', (data) => {
    safeSend(ws, {
      type: 'content_stop',
      index: data.index
    });
  });

  proc.on('tool_input_delta', (data) => {
    safeSend(ws, {
      type: 'tool_input_delta',
      json: data.json,
      index: data.index
    });
  });

  proc.on('message_start', (data) => {
    safeSend(ws, {
      type: 'message_start',
      message: data
    });
  });

  proc.on('message_delta', (data) => {
    safeSend(ws, {
      type: 'message_delta',
      stopReason: data.stopReason,
      usage: data.usage
    });
  });

  proc.on('complete', (data) => {
    safeSend(ws, {
      type: 'complete',
      messageId: data.messageId
    });
  });

  proc.on('result', (data) => {
    // Add result to history (store only the text, not full result object)
    sessionManager.addToHistory(session.id, {
      role: 'assistant',
      content: data.result || ''
    });

    safeSend(ws, {
      type: 'result',
      data
    });
  });

  proc.on('error', (data) => {
    safeSend(ws, {
      type: 'error',
      message: data.message,
      code: data.code
    });
  });

  proc.on('cancelled', () => {
    safeSend(ws, {
      type: 'cancelled'
    });
  });

  proc.on('text', (text) => {
    // Plain text output (non-JSON)
    safeSend(ws, {
      type: 'text',
      content: text
    });
  });

  proc.on('system', (data) => {
    safeSend(ws, {
      type: 'system',
      data
    });
  });

  proc.on('close', (code) => {
    safeSend(ws, {
      type: 'process_closed',
      code
    });

    // Only restart and re-attach listeners if WebSocket is still connected
    if (isWsOpen(ws)) {
      // Restart the Claude process for the same session so user can continue
      session.process.start();
      setupSessionListeners(ws, session);

      // Restore the mode from session to the restarted process
      if (session.mode && typeof session.process.setMode === 'function') {
        session.process.setMode(session.mode);
      }
    } else {
      console.log(`WebSocket closed, not restarting process for session ${session.id}`);
    }
  });

  proc.on('stderr', (text) => {
    console.error('[Claude stderr]', text);
    safeSend(ws, {
      type: 'stderr',
      text
    });
  });

  proc.on('prompt', (data) => {
    safeSend(ws, {
      type: 'prompt',
      requestId: data.request_id,
      toolUseId: data.toolUseId,
      toolName: data.toolName,
      input: data.input
    });
  });

  proc.on('permission_request', (data) => {
    safeSend(ws, {
      type: 'permission_request',
      requestId: data.request_id,
      toolName: data.request?.tool_name,
      toolInput: data.request?.input,
      toolUseId: data.request?.tool_use_id
    });
  });

  proc.on('tool_use', (data) => {
    safeSend(ws, {
      type: 'tool_use',
      id: data.id,
      name: data.name,
      input: data.input
    });
  });

  proc.on('agent_start', (data) => {
    safeSend(ws, {
      type: 'agent_start',
      taskId: data.taskId,
      description: data.description,
      agentType: data.agentType,
      startTime: data.startTime
    });
  });

  proc.on('task_notification', (data) => {
    safeSend(ws, {
      type: 'task_notification',
      taskId: data.taskId,
      status: data.status,
      summary: data.summary,
      outputFile: data.outputFile,
      description: data.description,
      agentType: data.agentType
    });
  });
}

function handleUserMessage(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session. Create or join a session first.');
    return;
  }

  if (!msg.content || typeof msg.content !== 'string') {
    sendError(ws, 'Message content is required');
    return;
  }

  // Add to history
  sessionManager.addToHistory(session.id, {
    role: 'user',
    content: msg.content
  });

  // Send to Claude
  const success = session.process.sendMessage(msg.content);

  if (!success) {
    sendError(ws, 'Failed to send message to Claude');
  } else {
    safeSend(ws, {
      type: 'message_sent'
    });
  }
}

function handleCancel(ws, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  session.process.cancel();
}

function handlePromptResponse(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  if (!msg.requestId || !msg.response) {
    sendError(ws, 'Request ID and response are required');
    return;
  }

  // Extract answers from response and pass to the pending prompt
  const answers = msg.response.answers || {};
  const success = session.process.sendPromptResponse(msg.requestId, answers);

  if (!success) {
    sendError(ws, 'Failed to send prompt response');
  }
}

function handlePermissionResponse(ws, msg, getCurrentSession) {
  console.log('handlePermissionResponse called with:', JSON.stringify(msg));
  const session = getCurrentSession();

  if (!session) {
    console.log('No active session for permission response');
    sendError(ws, 'No active session');
    return;
  }

  if (!msg.requestId || !msg.decision) {
    console.log('Missing requestId or decision:', msg.requestId, msg.decision);
    sendError(ws, 'Request ID and decision are required');
    return;
  }

  console.log('Calling sendControlResponse with:', msg.requestId, msg.decision);
  const success = session.process.sendControlResponse(
    msg.requestId,
    msg.decision,
    msg.toolInput || null  // Only pass if we have actual modifications
  );

  console.log('sendControlResponse returned:', success);
  if (!success) {
    sendError(ws, 'Failed to send permission response');
  }
}

function handleListSessions(ws) {
  const sessions = sessionManager.listSessions();
  safeSend(ws, {
    type: 'sessions_list',
    sessions
  });
}

function handleListAgents(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    safeSend(ws, {
      type: 'agents_list',
      agents: []
    });
    return;
  }

  const agents = sessionManager.listAgents(session.id);
  safeSend(ws, {
    type: 'agents_list',
    agents
  });
}

function handleSetMode(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session');
    return;
  }

  const validModes = ['default', 'acceptEdits', 'plan'];
  if (!msg.mode || !validModes.includes(msg.mode)) {
    sendError(ws, 'Invalid mode. Must be one of: default, acceptEdits, plan');
    return;
  }

  // Store mode on session and persist to database
  session.mode = msg.mode;
  sessionManager.setSessionMode(session.id, msg.mode);

  // Set mode on claude process
  if (session.process && typeof session.process.setMode === 'function') {
    session.process.setMode(msg.mode);
  }

  // Send confirmation
  safeSend(ws, {
    type: 'mode_changed',
    mode: msg.mode
  });
}

function sendError(ws, message) {
  safeSend(ws, {
    type: 'error',
    message
  });
}

function handleTerminalCreate(ws, msg, getCurrentSession) {
  const session = getCurrentSession();

  if (!session) {
    sendError(ws, 'No active session. Create or join a session first.');
    return;
  }

  const terminalId = msg.terminalId || session.id;
  const cwd = msg.cwd || session.workingDirectory;
  const username = ws.username || 'default';

  // Check if terminal already exists
  let terminal = terminalManager.getTerminal(terminalId);

  if (!terminal) {
    terminal = terminalManager.createTerminal(terminalId, cwd, username);

    terminal.on('data', (data) => {
      safeSend(ws, {
        type: 'terminal_data',
        terminalId: terminalId,
        data: data
      });
    });

    terminal.on('exit', ({ exitCode, signal }) => {
      safeSend(ws, {
        type: 'terminal_exit',
        terminalId: terminalId,
        exitCode,
        signal
      });
    });

    terminal.start();
  }

  safeSend(ws, {
    type: 'terminal_created',
    terminalId: terminalId,
    cwd: terminal.cwd
  });
}

function handleTerminalInput(ws, msg) {
  const { terminalId, data } = msg;

  if (!terminalId || !data) {
    sendError(ws, 'Terminal ID and data are required');
    return;
  }

  const terminal = terminalManager.getTerminal(terminalId);

  if (!terminal) {
    sendError(ws, 'Terminal not found');
    return;
  }

  terminal.write(data);
}

function handleTerminalResize(ws, msg) {
  const { terminalId, cols, rows } = msg;

  if (!terminalId || !cols || !rows) {
    sendError(ws, 'Terminal ID, cols, and rows are required');
    return;
  }

  const terminal = terminalManager.getTerminal(terminalId);

  if (!terminal) {
    sendError(ws, 'Terminal not found');
    return;
  }

  terminal.resize(cols, rows);
}

function handleTerminalClose(ws, msg) {
  const { terminalId } = msg;

  if (!terminalId) {
    sendError(ws, 'Terminal ID is required');
    return;
  }

  const success = terminalManager.terminateSession(terminalId);

  safeSend(ws, {
    type: 'terminal_closed',
    terminalId: terminalId,
    success
  });
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const addr = req.socket.remoteAddress;
  // Handle IPv6-mapped IPv4
  if (addr && addr.startsWith('::ffff:')) {
    return addr.substring(7);
  }
  return addr;
}

module.exports = { setupWebSocket };
