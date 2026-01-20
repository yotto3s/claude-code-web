/**
 * Session Manager Module
 *
 * Manages Claude sessions with SQLite persistence:
 * - Creates, retrieves, and terminates sessions
 * - Persists sessions and message history to database
 * - Recovers sessions on server restart
 * - Automatic cleanup of expired sessions
 * - Mode management (default, acceptEdits, plan)
 * - Allowed tools tracking (for "Allow All" permission persistence)
 * - Persistent listeners for capturing messages when user disconnects
 * - Pending message queue for offline delivery
 *
 * @module session-manager
 */

const { v4: uuidv4 } = require('uuid');
const { ClaudeProcess } = require('./claude-process');
const { sessionDatabase } = require('./database');
const { terminalManager } = require('./terminal-manager');

/** @type {number} Maximum concurrent sessions (default: 5) */
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5', 10);

/** @type {number} Session timeout in milliseconds (default: 1 hour) */
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000', 10);

/**
 * Manages Claude sessions with persistence.
 *
 * @class SessionManager
 */
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;

    // Load persisted sessions on startup
    this.loadPersistedSessions();

    // Start cleanup timer
    this.startCleanupTimer();
  }

  loadPersistedSessions() {
    try {
      // Load active sessions from database (without processes)
      const dbSessions = sessionDatabase.getActiveSessions();
      console.log(`Found ${dbSessions.length} persisted session(s) in database`);

      for (const dbSession of dbSessions) {
        // Load message history from database
        const messages = sessionDatabase.getMessages(dbSession.id);

        // Load allowed tools from database
        const allowedTools = new Set(sessionDatabase.getAllowedTools(dbSession.id));

        // Store metadata only - process will be created when user joins
        this.sessions.set(dbSession.id, {
          id: dbSession.id,
          name: dbSession.name,
          process: null, // Will be created on join via recoverSession()
          history: messages,
          createdAt: dbSession.created_at,
          lastActivity: dbSession.last_activity,
          workingDirectory: dbSession.working_directory,
          mode: dbSession.mode || 'plan',
          allowedTools, // Tools approved via "Allow All"
          sdkSessionId: dbSession.sdk_session_id || null, // SDK session ID for resume
          webSearchEnabled: Boolean(dbSession.web_search_enabled), // Web search toggle
          persisted: true, // Flag indicating this was loaded from DB
        });
      }
    } catch (err) {
      console.error('Error loading persisted sessions:', err.message);
    }
  }

  startCleanupTimer() {
    // Check for expired sessions every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000);
  }

  cleanupExpiredSessions() {
    const now = Date.now();

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > SESSION_TIMEOUT) {
        console.log(`Session ${id} expired, terminating`);
        this.terminateSession(id);
      }
    }

    // Also cleanup in database
    try {
      sessionDatabase.cleanupExpiredSessions(SESSION_TIMEOUT);
    } catch (err) {
      console.error('Error cleaning up expired sessions in database:', err.message);
    }
  }

  createSession(workingDirectory, name = null) {
    // Check if we've hit the session limit (only count sessions with active processes)
    const activeSessions = Array.from(this.sessions.values()).filter((s) => s.process !== null);

    if (activeSessions.length >= MAX_SESSIONS) {
      // Find and terminate the oldest inactive session
      let oldest = null;
      let oldestTime = Infinity;

      for (const [id, session] of this.sessions) {
        if (session.process && !session.process.isProcessing && session.lastActivity < oldestTime) {
          oldest = id;
          oldestTime = session.lastActivity;
        }
      }

      if (oldest) {
        console.log(`Max sessions reached, terminating oldest session ${oldest}`);
        this.terminateSession(oldest);
      } else {
        throw new Error('Max concurrent sessions reached');
      }
    }

    const id = uuidv4();
    const now = Date.now();

    const process = new ClaudeProcess(workingDirectory);

    const session = {
      id,
      name: name || `Session ${new Date(now).toLocaleString()}`,
      process,
      history: [],
      createdAt: now,
      lastActivity: now,
      workingDirectory,
      mode: 'plan',
      allowedTools: new Set(), // Tools approved via "Allow All"
      sdkSessionId: null, // Will be set when SDK initializes
      webSearchEnabled: false, // Web search toggle (default off)
      hasConnectedClient: false, // Track if a WebSocket client is connected
      currentMessageBuffer: '', // Buffer for accumulating assistant text
    };

    // Listen for SDK session ID so we can persist it for future resume
    process.once('sdk_session_id', (sdkSessionId) => {
      session.sdkSessionId = sdkSessionId;
      try {
        sessionDatabase.updateSdkSessionId(id, sdkSessionId);
        console.log(`[SessionManager] SDK session ID captured for session ${id}: ${sdkSessionId}`);
      } catch (err) {
        console.error('Error persisting SDK session ID:', err.message);
      }
    });

    process.start();

    this.sessions.set(id, session);

    // Set up persistent listeners for capturing messages even when user disconnects
    this.setupPersistentListeners(session);

    // Persist to database
    try {
      sessionDatabase.createSession(session);
    } catch (err) {
      console.error('Error persisting session to database:', err.message);
    }

    console.log(`Created session ${id} (${session.name})`);

    // Send initial prompt to read all markdown files
    this.sendInitialPrompt(session);

    return session;
  }

  // Recover a persisted session - create new Claude process
  recoverSession(id) {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.process === null) {
      console.log(`Recovering session ${id} - starting new Claude process`);

      // Pass SDK session ID to resume conversation context
      const resumeSessionId = session.sdkSessionId || null;
      if (resumeSessionId) {
        console.log(`[SessionManager] Will resume SDK session: ${resumeSessionId}`);
      } else {
        console.log(`[SessionManager] No SDK session ID available, starting fresh context`);
      }

      const process = new ClaudeProcess(session.workingDirectory, resumeSessionId);

      // Listen for new SDK session ID (in case resume creates a new one)
      process.once('sdk_session_id', (newSdkSessionId) => {
        if (newSdkSessionId !== session.sdkSessionId) {
          session.sdkSessionId = newSdkSessionId;
          try {
            sessionDatabase.updateSdkSessionId(id, newSdkSessionId);
            console.log(
              `[SessionManager] SDK session ID updated for recovered session ${id}: ${newSdkSessionId}`
            );
          } catch (err) {
            console.error('Error updating SDK session ID:', err.message);
          }
        }
      });

      process.start();

      // Restore mode if set
      if (session.mode && typeof process.setMode === 'function') {
        process.setMode(session.mode);
      }

      // Restore allowed tools if any
      if (session.allowedTools && session.allowedTools.size > 0) {
        process.setAllowedTools(session.allowedTools);
        console.log(`Restored ${session.allowedTools.size} allowed tool(s) for session ${id}`);
      }

      session.process = process;
      session.lastActivity = Date.now();

      // Initialize connection tracking fields if not present
      if (session.hasConnectedClient === undefined) {
        session.hasConnectedClient = false;
      }
      if (session.currentMessageBuffer === undefined) {
        session.currentMessageBuffer = '';
      }

      // Set up persistent listeners for the recovered process
      this.setupPersistentListeners(session);

      // Update last activity in database
      try {
        sessionDatabase.updateSessionActivity(id, session.lastActivity);
      } catch (err) {
        console.error('Error updating session activity in database:', err.message);
      }
    }

    return session;
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = Date.now();

      // Update in database
      try {
        sessionDatabase.updateSessionActivity(id, session.lastActivity);
      } catch (err) {
        // Don't fail the operation, just log
        console.error('Error updating session activity:', err.message);
      }
    }
    return session || null;
  }

  getOrCreateSession(id, workingDirectory) {
    let session = this.getSession(id);

    if (!session) {
      session = this.createSession(workingDirectory);
    }

    return session;
  }

  updateActivity(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = Date.now();

      try {
        sessionDatabase.updateSessionActivity(id, session.lastActivity);
      } catch (err) {
        console.error('Error updating session activity:', err.message);
      }
    }
  }

  addToHistory(id, entry) {
    const session = this.sessions.get(id);
    if (session) {
      const timestamp = Date.now();
      const historyEntry = {
        ...entry,
        timestamp,
      };

      session.history.push(historyEntry);
      session.lastActivity = timestamp;

      // Persist to database
      try {
        sessionDatabase.addMessage(id, entry.role, entry.content, timestamp);
        sessionDatabase.updateSessionActivity(id, timestamp);
      } catch (err) {
        console.error('Error persisting message to database:', err.message);
      }
    }
  }

  getHistory(id) {
    const session = this.sessions.get(id);
    return session ? session.history : [];
  }

  renameSession(id, newName) {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.name = newName || `Session ${new Date().toLocaleString()}`;
    session.lastActivity = Date.now();

    // Persist to database
    try {
      sessionDatabase.updateSessionName(id, session.name);
      sessionDatabase.updateSessionActivity(id, session.lastActivity);
    } catch (err) {
      console.error('Error updating session name in database:', err.message);
    }

    console.log(`Renamed session ${id} to "${session.name}"`);
    return true;
  }

  setSessionMode(id, mode) {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.mode = mode;

    // Persist to database
    try {
      sessionDatabase.updateSessionMode(id, mode);
    } catch (err) {
      console.error('Error updating session mode in database:', err.message);
    }

    return true;
  }

  setWebSearchEnabled(id, enabled) {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.webSearchEnabled = Boolean(enabled);

    // Update process if running
    if (session.process && typeof session.process.setWebSearchEnabled === 'function') {
      session.process.setWebSearchEnabled(enabled);
    }

    // Persist to database
    try {
      sessionDatabase.updateWebSearchEnabled(id, enabled);
    } catch (err) {
      console.error('Error updating web search setting in database:', err.message);
    }

    console.log(`Web search ${enabled ? 'enabled' : 'disabled'} for session ${id}`);
    return true;
  }

  // Allowed tools management (for "Allow All" permission persistence)
  addAllowedTool(id, toolName) {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Add to session memory
    if (!session.allowedTools) {
      session.allowedTools = new Set();
    }
    session.allowedTools.add(toolName);

    // Also add to process if running
    if (session.process) {
      session.process.addAllowedTool(toolName);
    }

    // Persist to database
    try {
      sessionDatabase.addAllowedTool(id, toolName);
    } catch (err) {
      console.error('Error persisting allowed tool to database:', err.message);
    }

    console.log(`Added allowed tool "${toolName}" to session ${id}`);
    return true;
  }

  isToolAllowed(id, toolName) {
    const session = this.sessions.get(id);
    if (!session || !session.allowedTools) return false;
    return session.allowedTools.has(toolName);
  }

  getAllowedTools(id) {
    const session = this.sessions.get(id);
    if (!session || !session.allowedTools) return [];
    return Array.from(session.allowedTools);
  }

  clearAllowedTools(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.allowedTools = new Set();

    // Also clear in process if running
    if (session.process) {
      session.process.clearAllowedTools();
    }

    // Persist to database
    try {
      sessionDatabase.clearAllowedTools(id);
    } catch (err) {
      console.error('Error clearing allowed tools in database:', err.message);
    }

    console.log(`Cleared all allowed tools for session ${id}`);
    return true;
  }

  terminateSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.process) {
      session.process.terminate();
    }

    // Cleanup any terminals associated with this session
    terminalManager.terminateSessionTerminals(id);

    // Mark as inactive in database (keep history)
    try {
      sessionDatabase.deactivateSession(id);
    } catch (err) {
      console.error('Error deactivating session in database:', err.message);
    }

    this.sessions.delete(id);
    console.log(`Terminated session ${id}`);

    return true;
  }

  removeSession(id) {
    const session = this.sessions.get(id);

    // Terminate process if exists
    if (session && session.process) {
      session.process.terminate();
    }

    // Cleanup any terminals associated with this session
    terminalManager.terminateSessionTerminals(id);

    // Remove from memory
    this.sessions.delete(id);

    // Delete from database (cascades to messages and allowed_tools)
    try {
      sessionDatabase.deleteSession(id);
      console.log(`Removed session ${id}`);
      return true;
    } catch (err) {
      console.error('Error removing session from database:', err.message);
      return false;
    }
  }

  terminateAll() {
    // Only terminate processes, but DON'T deactivate sessions in database
    // Sessions should persist across server restarts so users can rejoin them
    for (const [_id, session] of this.sessions) {
      if (session.process) {
        session.process.terminate();
      }
      // Note: We intentionally don't call sessionDatabase.deactivateSession(id) here
      // Sessions are only deactivated when explicitly terminated by user or expired
    }
    this.sessions.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close database connection properly (triggers WAL checkpoint)
    try {
      sessionDatabase.close();
    } catch (err) {
      console.error('Error closing database:', err.message);
    }

    console.log('All sessions terminated');
  }

  listSessions() {
    const sessions = [];

    for (const [id, session] of this.sessions) {
      sessions.push({
        id,
        name: session.name,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        historyLength: session.history.length,
        isProcessing: session.process?.isProcessing || false,
        workingDirectory: session.workingDirectory,
        agents: session.process?.getActiveAgents() || [],
        hasActiveProcess: session.process !== null,
      });
    }

    return sessions;
  }

  listAgents(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.process) return [];
    return session.process.getActiveAgents();
  }

  getSessionCount() {
    return this.sessions.size;
  }

  /**
   * Send initial prompt to read all markdown files in the project.
   * Called automatically when a new session is created to help Claude
   * understand the project context.
   *
   * @param {object} session - The session object
   */
  sendInitialPrompt(session) {
    const initialPrompt = `Please read all markdown files in this project to understand it. Use the Glob tool to find all files matching "**/*.md", then read each one to build a comprehensive understanding of this project's structure, purpose, documentation, and how it works. After reading all the markdown files, provide a brief summary of what this project is about.`;

    // Small delay to ensure WebSocket listeners are set up on the client
    setTimeout(() => {
      if (session.process) {
        session.process.sendMessage(initialPrompt);

        // Add the initial prompt to history
        this.addToHistory(session.id, {
          role: 'user',
          content: initialPrompt,
        });

        console.log(`[SessionManager] Sent initial prompt to read markdown files for session ${session.id}`);
      }
    }, 100);
  }

  /**
   * Set up persistent listeners on the Claude process.
   * These listeners capture messages and persist them even when no WebSocket client is connected.
   * They also queue messages for delivery when a client reconnects.
   *
   * @param {object} session - The session object
   */
  setupPersistentListeners(session) {
    const proc = session.process;
    if (!proc) return;

    // Mark listeners as persistent so WebSocket handler knows not to remove them
    const createPersistentListener = (handler) => {
      handler._persistent = true;
      return handler;
    };

    // Persistent chunk handler - accumulates text and queues for offline delivery
    proc.on(
      'chunk',
      createPersistentListener((data) => {
        // Accumulate text for history persistence
        if (data.text) {
          session.currentMessageBuffer += data.text;
        }

        // If no client connected, queue the message for later delivery
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'chunk', data);
        }
      })
    );

    // Persistent result handler - saves accumulated message to history
    proc.on(
      'result',
      createPersistentListener((data) => {
        // Save accumulated message to history
        if (session.currentMessageBuffer) {
          this.addToHistory(session.id, {
            role: 'assistant',
            content: session.currentMessageBuffer,
          });
          session.currentMessageBuffer = '';
        }

        // Queue for offline delivery
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'result', data);
        }
      })
    );

    // Persistent complete handler
    proc.on(
      'complete',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'complete', data);
        }
      })
    );

    // Persistent error handler
    proc.on(
      'error',
      createPersistentListener((data) => {
        // Reset buffer on error
        session.currentMessageBuffer = '';

        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'error', data);
        }
      })
    );

    // Persistent cancelled handler
    proc.on(
      'cancelled',
      createPersistentListener(() => {
        // Reset buffer on cancellation
        session.currentMessageBuffer = '';

        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'cancelled', {});
        }
      })
    );

    // Persistent tool_use handler
    proc.on(
      'tool_use',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'tool_use', data);
        }
      })
    );

    // Persistent agent_start handler
    proc.on(
      'agent_start',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'agent_start', data);
        }
      })
    );

    // Persistent task_notification handler
    proc.on(
      'task_notification',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'task_notification', data);
        }
      })
    );

    // Persistent permission_request handler - these need special handling
    // We queue them but they may timeout if user doesn't reconnect
    proc.on(
      'permission_request',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'permission_request', data);
        }
      })
    );

    // Persistent prompt handler
    proc.on(
      'prompt',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'prompt', data);
        }
      })
    );

    // Persistent exit_plan_mode_request handler
    proc.on(
      'exit_plan_mode_request',
      createPersistentListener((data) => {
        if (!session.hasConnectedClient) {
          this.queuePendingMessage(session.id, 'exit_plan_mode_request', data);
        }
      })
    );

    console.log(`[SessionManager] Persistent listeners set up for session ${session.id}`);
  }

  /**
   * Queue a message for delivery when client reconnects.
   *
   * @param {string} sessionId - Session ID
   * @param {string} messageType - Type of message
   * @param {object} data - Message data
   */
  queuePendingMessage(sessionId, messageType, data) {
    try {
      sessionDatabase.addPendingMessage(sessionId, messageType, data);
    } catch (err) {
      console.error(`Error queuing pending message for session ${sessionId}:`, err.message);
    }
  }

  /**
   * Get pending messages for a session (called when client reconnects).
   *
   * @param {string} sessionId - Session ID
   * @returns {Array} Array of pending messages
   */
  getPendingMessages(sessionId) {
    try {
      return sessionDatabase.getPendingMessages(sessionId);
    } catch (err) {
      console.error(`Error getting pending messages for session ${sessionId}:`, err.message);
      return [];
    }
  }

  /**
   * Mark pending messages as delivered and clean them up.
   *
   * @param {string} sessionId - Session ID
   * @param {number[]} messageIds - Array of message IDs to mark as delivered
   */
  markMessagesDelivered(sessionId, messageIds) {
    try {
      sessionDatabase.markMessagesDelivered(sessionId, messageIds);
      sessionDatabase.clearPendingMessages(sessionId);
    } catch (err) {
      console.error(`Error marking messages delivered for session ${sessionId}:`, err.message);
    }
  }

  /**
   * Set the client connection status for a session.
   *
   * @param {string} sessionId - Session ID
   * @param {boolean} connected - Whether a client is connected
   */
  setClientConnected(sessionId, connected) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.hasConnectedClient = connected;
      console.log(
        `[SessionManager] Client ${connected ? 'connected' : 'disconnected'} for session ${sessionId}`
      );
    }
  }

  /**
   * Check if a session has a connected client.
   *
   * @param {string} sessionId - Session ID
   * @returns {boolean} Whether a client is connected
   */
  hasConnectedClient(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.hasConnectedClient : false;
  }
}

const sessionManager = new SessionManager();

module.exports = { sessionManager, SessionManager };
