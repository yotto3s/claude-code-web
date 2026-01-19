const { v4: uuidv4 } = require('uuid');
const { ClaudeProcess } = require('./claude-process');
const { sessionDatabase } = require('./database');

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5', 10);
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000', 10);

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

        // Store metadata only - process will be created when user joins
        this.sessions.set(dbSession.id, {
          id: dbSession.id,
          name: dbSession.name,
          process: null, // Will be created on join via recoverSession()
          history: messages,
          createdAt: dbSession.created_at,
          lastActivity: dbSession.last_activity,
          workingDirectory: dbSession.working_directory,
          mode: dbSession.mode || 'default',
          persisted: true // Flag indicating this was loaded from DB
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
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.process !== null);

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
    process.start();

    const session = {
      id,
      name: name || `Session ${new Date(now).toLocaleString()}`,
      process,
      history: [],
      createdAt: now,
      lastActivity: now,
      workingDirectory,
      mode: 'default'
    };

    this.sessions.set(id, session);

    // Persist to database
    try {
      sessionDatabase.createSession(session);
    } catch (err) {
      console.error('Error persisting session to database:', err.message);
    }

    console.log(`Created session ${id} (${session.name})`);

    return session;
  }

  // Recover a persisted session - create new Claude process
  recoverSession(id) {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.process === null) {
      console.log(`Recovering session ${id} - starting new Claude process`);

      const process = new ClaudeProcess(session.workingDirectory);
      process.start();

      // Restore mode if set
      if (session.mode && typeof process.setMode === 'function') {
        process.setMode(session.mode);
      }

      session.process = process;
      session.lastActivity = Date.now();

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
        timestamp
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

  terminateSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    if (session.process) {
      session.process.terminate();
    }

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

  terminateAll() {
    for (const [id, session] of this.sessions) {
      if (session.process) {
        session.process.terminate();
      }

      // Mark as inactive in database
      try {
        sessionDatabase.deactivateSession(id);
      } catch (err) {
        console.error('Error deactivating session in database:', err.message);
      }
    }
    this.sessions.clear();

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
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
        hasActiveProcess: session.process !== null
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
}

const sessionManager = new SessionManager();

module.exports = { sessionManager, SessionManager };
