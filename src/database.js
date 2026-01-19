/**
 * Session Database Module
 *
 * SQLite persistence layer for session management using better-sqlite3.
 *
 * Features:
 * - WAL mode for better concurrent access
 * - Periodic WAL checkpoints (every 5 minutes)
 * - Foreign key constraints for data integrity
 *
 * Schema:
 * - sessions: id, name, working_directory, mode, sdk_session_id, web_search_enabled, created_at, last_activity, is_active
 * - messages: id, session_id, role, content, timestamp
 * - allowed_tools: id, session_id, tool_name, allowed_at (for persisting "Allow All" decisions)
 *
 * @module database
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** @type {string} Path to the SQLite database file */
const DB_PATH = path.join(DATA_DIR, 'sessions.db');

/**
 * SQLite database wrapper for session persistence.
 *
 * @class SessionDatabase
 */
class SessionDatabase {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.migrateSchema();

    // Checkpoint WAL periodically (every 5 minutes) to ensure data is written to main DB
    this.checkpointInterval = setInterval(
      () => {
        try {
          this.db.pragma('wal_checkpoint(PASSIVE)');
        } catch (err) {
          console.error('Error during WAL checkpoint:', err.message);
        }
      },
      5 * 60 * 1000
    );
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        mode TEXT DEFAULT 'default',
        sdk_session_id TEXT,
        web_search_enabled INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);
      CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);

      CREATE TABLE IF NOT EXISTS allowed_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        allowed_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, tool_name)
      );

      CREATE INDEX IF NOT EXISTS idx_allowed_tools_session_id ON allowed_tools(session_id);
    `);
  }

  /**
   * Migrate schema for existing databases.
   * Adds new columns if they don't exist.
   */
  migrateSchema() {
    // Check if sdk_session_id column exists
    const tableInfo = this.db.prepare('PRAGMA table_info(sessions)').all();
    const hasSdkSessionId = tableInfo.some((col) => col.name === 'sdk_session_id');

    if (!hasSdkSessionId) {
      console.log('[Database] Migrating: adding sdk_session_id column to sessions table');
      this.db.exec('ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT');
    }

    // Check if web_search_enabled column exists
    const hasWebSearchEnabled = tableInfo.some((col) => col.name === 'web_search_enabled');
    if (!hasWebSearchEnabled) {
      console.log('[Database] Migrating: adding web_search_enabled column to sessions table');
      this.db.exec('ALTER TABLE sessions ADD COLUMN web_search_enabled INTEGER DEFAULT 0');
    }
  }

  // Session CRUD operations
  createSession(session) {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const result = stmt.run(
      session.id,
      session.name,
      session.workingDirectory,
      session.mode || 'default',
      session.createdAt,
      session.lastActivity
    );
    console.log(`[Database] Session ${session.id} persisted (changes: ${result.changes})`);
  }

  updateSessionActivity(sessionId, timestamp) {
    const stmt = this.db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?');
    stmt.run(timestamp, sessionId);
  }

  updateSessionMode(sessionId, mode) {
    const stmt = this.db.prepare('UPDATE sessions SET mode = ? WHERE id = ?');
    stmt.run(mode, sessionId);
  }

  updateSessionName(sessionId, name) {
    const stmt = this.db.prepare('UPDATE sessions SET name = ? WHERE id = ?');
    stmt.run(name, sessionId);
  }

  /**
   * Update the SDK session ID for a session.
   * This is the Claude Agent SDK's internal session ID used for resume.
   *
   * @param {string} sessionId - Our session ID
   * @param {string} sdkSessionId - The SDK's session ID
   */
  updateSdkSessionId(sessionId, sdkSessionId) {
    const stmt = this.db.prepare('UPDATE sessions SET sdk_session_id = ? WHERE id = ?');
    stmt.run(sdkSessionId, sessionId);
    console.log(`[Database] SDK session ID updated for session ${sessionId}: ${sdkSessionId}`);
  }

  /**
   * Update web search enabled setting for a session.
   *
   * @param {string} sessionId - Session ID
   * @param {boolean} enabled - Whether web search is enabled
   */
  updateWebSearchEnabled(sessionId, enabled) {
    const stmt = this.db.prepare('UPDATE sessions SET web_search_enabled = ? WHERE id = ?');
    stmt.run(enabled ? 1 : 0, sessionId);
    console.log(
      `[Database] Web search ${enabled ? 'enabled' : 'disabled'} for session ${sessionId}`
    );
  }

  deactivateSession(sessionId) {
    const stmt = this.db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?');
    stmt.run(sessionId);
  }

  deleteSession(sessionId) {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    stmt.run(sessionId);
  }

  getSession(sessionId) {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return stmt.get(sessionId);
  }

  getActiveSessions() {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE is_active = 1 ORDER BY last_activity DESC'
    );
    return stmt.all();
  }

  getAllSessions() {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_activity DESC');
    return stmt.all();
  }

  // Message CRUD operations
  addMessage(sessionId, role, content, timestamp) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sessionId, role, content, timestamp);
  }

  getMessages(sessionId) {
    const stmt = this.db.prepare(
      'SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC'
    );
    return stmt.all(sessionId);
  }

  deleteMessages(sessionId) {
    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
  }

  // Allowed Tools CRUD operations (for "Allow All" persistence)
  addAllowedTool(sessionId, toolName) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(sessionId, toolName, Date.now());
    console.log(`[Database] Tool "${toolName}" allowed for session ${sessionId}`);
  }

  getAllowedTools(sessionId) {
    const stmt = this.db.prepare('SELECT tool_name FROM allowed_tools WHERE session_id = ?');
    return stmt.all(sessionId).map((row) => row.tool_name);
  }

  isToolAllowed(sessionId, toolName) {
    const stmt = this.db.prepare(
      'SELECT 1 FROM allowed_tools WHERE session_id = ? AND tool_name = ?'
    );
    return stmt.get(sessionId, toolName) !== undefined;
  }

  removeAllowedTool(sessionId, toolName) {
    const stmt = this.db.prepare(
      'DELETE FROM allowed_tools WHERE session_id = ? AND tool_name = ?'
    );
    stmt.run(sessionId, toolName);
  }

  clearAllowedTools(sessionId) {
    const stmt = this.db.prepare('DELETE FROM allowed_tools WHERE session_id = ?');
    stmt.run(sessionId);
  }

  // Cleanup operations
  cleanupExpiredSessions(maxAge) {
    const cutoff = Date.now() - maxAge;
    const stmt = this.db.prepare(
      'UPDATE sessions SET is_active = 0 WHERE last_activity < ? AND is_active = 1'
    );
    return stmt.run(cutoff);
  }

  close() {
    // Clear checkpoint interval
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
      this.checkpointInterval = null;
    }

    // Final checkpoint to ensure all WAL data is written to main database
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      console.log('[Database] WAL checkpoint completed');
    } catch (err) {
      console.error('[Database] Error during final checkpoint:', err.message);
    }

    this.db.close();
    console.log('[Database] Connection closed');
  }
}

// Export singleton
const sessionDatabase = new SessionDatabase();

module.exports = { sessionDatabase, SessionDatabase };
