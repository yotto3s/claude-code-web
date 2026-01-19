const { v4: uuidv4 } = require('uuid');
const { ClaudeProcess } = require('./claude-process');

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '5', 10);
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT || '3600000', 10);

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.cleanupInterval = null;

    // Start cleanup timer
    this.startCleanupTimer();
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
  }

  createSession(workingDirectory) {
    // Check if we've hit the session limit
    if (this.sessions.size >= MAX_SESSIONS) {
      // Find and terminate the oldest inactive session
      let oldest = null;
      let oldestTime = Infinity;

      for (const [id, session] of this.sessions) {
        if (!session.process.isProcessing && session.lastActivity < oldestTime) {
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
      process,
      history: [],
      createdAt: now,
      lastActivity: now,
      workingDirectory,
      mode: 'default'
    };

    this.sessions.set(id, session);
    console.log(`Created session ${id}`);

    return session;
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = Date.now();
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
    }
  }

  addToHistory(id, entry) {
    const session = this.sessions.get(id);
    if (session) {
      session.history.push({
        ...entry,
        timestamp: Date.now()
      });
      session.lastActivity = Date.now();
    }
  }

  getHistory(id) {
    const session = this.sessions.get(id);
    return session ? session.history : [];
  }

  terminateSession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;

    session.process.terminate();
    this.sessions.delete(id);
    console.log(`Terminated session ${id}`);

    return true;
  }

  terminateAll() {
    for (const [id, session] of this.sessions) {
      session.process.terminate();
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
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        historyLength: session.history.length,
        isProcessing: session.process.isProcessing,
        workingDirectory: session.workingDirectory
      });
    }

    return sessions;
  }

  getSessionCount() {
    return this.sessions.size;
  }
}

const sessionManager = new SessionManager();

module.exports = { sessionManager, SessionManager };
