const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'sessions.db');

class SessionDatabase {
  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        mode TEXT DEFAULT 'default',
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
    `);
  }

  // Session CRUD operations
  createSession(session) {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(
      session.id,
      session.name,
      session.workingDirectory,
      session.mode || 'default',
      session.createdAt,
      session.lastActivity
    );
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
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE is_active = 1 ORDER BY last_activity DESC');
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
    const stmt = this.db.prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC');
    return stmt.all(sessionId);
  }

  deleteMessages(sessionId) {
    const stmt = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    stmt.run(sessionId);
  }

  // Cleanup operations
  cleanupExpiredSessions(maxAge) {
    const cutoff = Date.now() - maxAge;
    const stmt = this.db.prepare('UPDATE sessions SET is_active = 0 WHERE last_activity < ? AND is_active = 1');
    return stmt.run(cutoff);
  }

  close() {
    this.db.close();
  }
}

// Export singleton
const sessionDatabase = new SessionDatabase();

module.exports = { sessionDatabase, SessionDatabase };
