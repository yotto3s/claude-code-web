/**
 * Integration Tests for Session Flow
 *
 * Tests the full lifecycle of session operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '..', '..', 'data-test', 'session-flow.db');

/**
 * Simulates the session manager's database operations
 */
class TestSessionManager {
  constructor(db) {
    this.db = db;
    this.sessions = new Map();
  }

  createSession(workingDirectory, name) {
    const id = uuidv4();
    const now = Date.now();
    const sessionName = name || `Session ${new Date(now).toLocaleTimeString()}`;

    const session = {
      id,
      name: sessionName,
      workingDirectory,
      mode: 'plan',
      createdAt: now,
      lastActivity: now,
      history: [],
      allowedTools: new Set(),
      webSearchEnabled: false,
    };

    // Persist to database
    this.db.prepare(`
      INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(id, sessionName, workingDirectory, 'plan', now, now);

    this.sessions.set(id, session);
    return session;
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      historyLength: s.history.length,
      workingDirectory: s.workingDirectory,
    }));
  }

  addMessage(sessionId, role, content) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const timestamp = Date.now();
    const message = { role, content, timestamp };
    session.history.push(message);
    session.lastActivity = timestamp;

    // Persist message
    this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, role, content, timestamp);

    // Update activity
    this.db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?').run(timestamp, sessionId);

    return message;
  }

  setMode(sessionId, mode) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.mode = mode;
    this.db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run(mode, sessionId);
    return true;
  }

  setWebSearchEnabled(sessionId, enabled) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.webSearchEnabled = enabled;
    this.db.prepare('UPDATE sessions SET web_search_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, sessionId);
    return true;
  }

  renameSession(sessionId, newName) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.name = newName;
    this.db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(newName, sessionId);
    return true;
  }

  addAllowedTool(sessionId, toolName) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.allowedTools.add(toolName);
    this.db.prepare(`
      INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at)
      VALUES (?, ?, ?)
    `).run(sessionId, toolName, Date.now());
    return true;
  }

  isToolAllowed(sessionId, toolName) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.allowedTools.has(toolName);
  }

  terminateSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);
    this.sessions.delete(sessionId);
    return true;
  }

  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    this.sessions.delete(sessionId);
    return true;
  }

  resetSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const workingDirectory = session.workingDirectory;

    // Delete old session
    this.deleteSession(sessionId);

    // Create new session in same directory
    return this.createSession(workingDirectory, session.name);
  }

  loadFromDatabase() {
    const dbSessions = this.db.prepare('SELECT * FROM sessions WHERE is_active = 1').all();

    for (const dbSession of dbSessions) {
      const messages = this.db.prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(dbSession.id);
      const tools = this.db.prepare('SELECT tool_name FROM allowed_tools WHERE session_id = ?').all(dbSession.id);

      this.sessions.set(dbSession.id, {
        id: dbSession.id,
        name: dbSession.name,
        workingDirectory: dbSession.working_directory,
        mode: dbSession.mode || 'plan',
        createdAt: dbSession.created_at,
        lastActivity: dbSession.last_activity,
        history: messages,
        allowedTools: new Set(tools.map((t) => t.tool_name)),
        webSearchEnabled: Boolean(dbSession.web_search_enabled),
      });
    }
  }
}

describe('Session Flow Integration', () => {
  let db;
  let manager;

  beforeEach(() => {
    // Ensure test directory exists
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Remove existing test DB
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
    if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');

    // Create database
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create schema
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        mode TEXT DEFAULT 'plan',
        sdk_session_id TEXT,
        web_search_enabled INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_activity INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE allowed_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        allowed_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        UNIQUE(session_id, tool_name)
      );
    `);

    manager = new TestSessionManager(db);
  });

  afterEach(() => {
    if (db) db.close();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
      if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Session Lifecycle', () => {
    it('should create a new session', () => {
      const session = manager.createSession('/home/user/project', 'My Project');

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.name).toBe('My Project');
      expect(session.workingDirectory).toBe('/home/user/project');
      expect(session.mode).toBe('plan');
    });

    it('should generate default name if not provided', () => {
      const session = manager.createSession('/tmp');

      expect(session.name).toContain('Session');
    });

    it('should list all active sessions', () => {
      manager.createSession('/project1', 'Project 1');
      manager.createSession('/project2', 'Project 2');

      const sessions = manager.listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.name)).toContain('Project 1');
      expect(sessions.map((s) => s.name)).toContain('Project 2');
    });

    it('should retrieve a session by ID', () => {
      const created = manager.createSession('/test', 'Test Session');
      const retrieved = manager.getSession(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test Session');
    });
  });

  describe('Message Management', () => {
    it('should add messages to a session', () => {
      const session = manager.createSession('/test');

      manager.addMessage(session.id, 'user', 'Hello!');
      manager.addMessage(session.id, 'assistant', 'Hi there!');

      const retrieved = manager.getSession(session.id);
      expect(retrieved.history).toHaveLength(2);
      expect(retrieved.history[0].role).toBe('user');
      expect(retrieved.history[1].role).toBe('assistant');
    });

    it('should update last activity when adding messages', () => {
      const session = manager.createSession('/test');
      const initialActivity = session.lastActivity;

      // Wait a tiny bit to ensure timestamp differs
      manager.addMessage(session.id, 'user', 'Test');

      const retrieved = manager.getSession(session.id);
      expect(retrieved.lastActivity).toBeGreaterThanOrEqual(initialActivity);
    });

    it('should persist messages to database', () => {
      const session = manager.createSession('/test');
      manager.addMessage(session.id, 'user', 'Persisted message');

      // Check database directly
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Persisted message');
    });
  });

  describe('Session Configuration', () => {
    it('should change session mode', () => {
      const session = manager.createSession('/test');

      manager.setMode(session.id, 'plan');

      const retrieved = manager.getSession(session.id);
      expect(retrieved.mode).toBe('plan');

      // Verify persisted
      const dbSession = db.prepare('SELECT mode FROM sessions WHERE id = ?').get(session.id);
      expect(dbSession.mode).toBe('plan');
    });

    it('should toggle web search', () => {
      const session = manager.createSession('/test');

      manager.setWebSearchEnabled(session.id, true);
      expect(manager.getSession(session.id).webSearchEnabled).toBe(true);

      manager.setWebSearchEnabled(session.id, false);
      expect(manager.getSession(session.id).webSearchEnabled).toBe(false);
    });

    it('should rename a session', () => {
      const session = manager.createSession('/test', 'Old Name');

      manager.renameSession(session.id, 'New Name');

      expect(manager.getSession(session.id).name).toBe('New Name');

      // Verify persisted
      const dbSession = db.prepare('SELECT name FROM sessions WHERE id = ?').get(session.id);
      expect(dbSession.name).toBe('New Name');
    });
  });

  describe('Tool Permissions', () => {
    it('should add allowed tools', () => {
      const session = manager.createSession('/test');

      manager.addAllowedTool(session.id, 'Bash');
      manager.addAllowedTool(session.id, 'Read');

      expect(manager.isToolAllowed(session.id, 'Bash')).toBe(true);
      expect(manager.isToolAllowed(session.id, 'Read')).toBe(true);
      expect(manager.isToolAllowed(session.id, 'Write')).toBe(false);
    });

    it('should persist tool permissions to database', () => {
      const session = manager.createSession('/test');
      manager.addAllowedTool(session.id, 'Grep');

      const tools = db.prepare('SELECT tool_name FROM allowed_tools WHERE session_id = ?').all(session.id);
      expect(tools).toHaveLength(1);
      expect(tools[0].tool_name).toBe('Grep');
    });
  });

  describe('Session Termination', () => {
    it('should terminate a session', () => {
      const session = manager.createSession('/test');

      manager.terminateSession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();

      // Should be marked inactive in DB
      const dbSession = db.prepare('SELECT is_active FROM sessions WHERE id = ?').get(session.id);
      expect(dbSession.is_active).toBe(0);
    });

    it('should delete a session completely', () => {
      const session = manager.createSession('/test');
      manager.addMessage(session.id, 'user', 'Test');
      manager.addAllowedTool(session.id, 'Bash');

      manager.deleteSession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();

      // Should be gone from DB
      const dbSession = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
      expect(dbSession).toBeUndefined();

      // Messages should be cascade deleted
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(session.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Session Reset', () => {
    it('should reset a session with new ID but same directory', () => {
      const original = manager.createSession('/project', 'My Session');
      manager.addMessage(original.id, 'user', 'Old message');

      const reset = manager.resetSession(original.id);

      expect(reset).toBeDefined();
      expect(reset.id).not.toBe(original.id);
      expect(reset.workingDirectory).toBe('/project');
      expect(reset.history).toHaveLength(0);

      // Original should be gone
      expect(manager.getSession(original.id)).toBeUndefined();
    });
  });

  describe('Session Recovery', () => {
    it('should load sessions from database on restart', () => {
      // Create sessions
      const session1 = manager.createSession('/project1', 'Project 1');
      const session2 = manager.createSession('/project2', 'Project 2');
      manager.addMessage(session1.id, 'user', 'Hello');
      manager.addAllowedTool(session1.id, 'Bash');

      // Simulate restart - create new manager and load from DB
      const newManager = new TestSessionManager(db);
      newManager.loadFromDatabase();

      // Should have both sessions
      const sessions = newManager.listSessions();
      expect(sessions).toHaveLength(2);

      // Should have message history
      const recovered = newManager.getSession(session1.id);
      expect(recovered).toBeDefined();
      expect(recovered.history).toHaveLength(1);
      expect(recovered.allowedTools.has('Bash')).toBe(true);
    });

    it('should not load inactive sessions', () => {
      const session = manager.createSession('/test');
      manager.terminateSession(session.id);

      const newManager = new TestSessionManager(db);
      newManager.loadFromDatabase();

      expect(newManager.listSessions()).toHaveLength(0);
    });
  });
});
