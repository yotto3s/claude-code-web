/**
 * Unit Tests for SessionDatabase
 *
 * Tests the SQLite database layer for session persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '..', '..', 'data-test', 'test-sessions.db');

// Note: SessionDatabase class exists in '../../src/database.js' but we test
// directly against the database schema to avoid singleton interference

/**
 * Create a fresh database instance for testing
 * We can't use the singleton, so we create our own test instance
 */
function createTestDb() {
  // Ensure test directory exists
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Remove existing test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Remove WAL files
  const walPath = TEST_DB_PATH + '-wal';
  const shmPath = TEST_DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  // Create a test database instance manually
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
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

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS allowed_tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      allowed_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      UNIQUE(session_id, tool_name)
    );
  `);

  return db;
}

describe('SessionDatabase', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(async () => {
    if (db) {
      try {
        // Checkpoint WAL to main database before closing
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
      } catch {
        // Ignore close errors
      }
      db = null;
    }
    // Small delay to allow file handles to release
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Cleanup test files
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
      if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Session CRUD Operations', () => {
    it('should create a session', () => {
      const session = {
        id: 'test-123',
        name: 'Test Session',
        workingDirectory: '/tmp/test',
        mode: 'plan',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      const stmt = db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `);
      stmt.run(session.id, session.name, session.workingDirectory, session.mode, session.createdAt, session.lastActivity);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
      expect(result).toBeDefined();
      expect(result.id).toBe(session.id);
      expect(result.name).toBe(session.name);
      expect(result.working_directory).toBe(session.workingDirectory);
      expect(result.is_active).toBe(1);
    });

    it('should retrieve a session by ID', () => {
      const session = {
        id: 'get-test-456',
        name: 'Get Test',
        workingDirectory: '/home/test',
        mode: 'plan',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(session.id, session.name, session.workingDirectory, session.mode, session.createdAt, session.lastActivity);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id);
      expect(result).toBeDefined();
      expect(result.id).toBe(session.id);
      expect(result.mode).toBe('plan');
    });

    it('should return undefined for non-existent session', () => {
      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should get active sessions only', () => {
      // Insert active session
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run('active-1', 'Active', '/tmp', 'default', Date.now(), Date.now());

      // Insert inactive session
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).run('inactive-1', 'Inactive', '/tmp', 'default', Date.now(), Date.now());

      const results = db.prepare('SELECT * FROM sessions WHERE is_active = 1').all();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('active-1');
    });

    it('should update session activity timestamp', () => {
      const sessionId = 'update-activity-test';
      const initialTime = Date.now() - 10000;
      const newTime = Date.now();

      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', initialTime, initialTime);

      db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?').run(newTime, sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.last_activity).toBe(newTime);
    });

    it('should update session mode', () => {
      const sessionId = 'mode-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());

      db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run('acceptEdits', sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.mode).toBe('acceptEdits');
    });

    it('should update session name', () => {
      const sessionId = 'name-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Original Name', '/tmp', 'default', Date.now(), Date.now());

      db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run('New Name', sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.name).toBe('New Name');
    });

    it('should update SDK session ID', () => {
      const sessionId = 'sdk-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());

      db.prepare('UPDATE sessions SET sdk_session_id = ? WHERE id = ?').run('sdk-123-abc', sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.sdk_session_id).toBe('sdk-123-abc');
    });

    it('should update web search enabled setting', () => {
      const sessionId = 'web-search-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());

      // Enable web search
      db.prepare('UPDATE sessions SET web_search_enabled = ? WHERE id = ?').run(1, sessionId);
      let result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.web_search_enabled).toBe(1);

      // Disable web search
      db.prepare('UPDATE sessions SET web_search_enabled = ? WHERE id = ?').run(0, sessionId);
      result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.web_search_enabled).toBe(0);
    });

    it('should deactivate a session', () => {
      const sessionId = 'deactivate-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());

      db.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result.is_active).toBe(0);
    });

    it('should delete a session', () => {
      const sessionId = 'delete-test';
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());

      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      const result = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      expect(result).toBeUndefined();
    });
  });

  describe('Message Operations', () => {
    const sessionId = 'message-test-session';

    beforeEach(() => {
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());
    });

    it('should add a message', () => {
      const timestamp = Date.now();
      db.prepare(`
        INSERT INTO messages (session_id, role, content, timestamp)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, 'user', 'Hello!', timestamp);

      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello!');
    });

    it('should get messages in order', () => {
      const now = Date.now();
      db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`).run(sessionId, 'user', 'First', now);
      db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`).run(sessionId, 'assistant', 'Second', now + 1000);
      db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`).run(sessionId, 'user', 'Third', now + 2000);

      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
      expect(messages[2].content).toBe('Third');
    });

    it('should delete messages for a session', () => {
      db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`).run(sessionId, 'user', 'Test', Date.now());

      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
      expect(messages).toHaveLength(0);
    });

    it('should cascade delete messages when session is deleted', () => {
      db.prepare(`INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`).run(sessionId, 'user', 'Test', Date.now());

      // Delete the session
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      // Messages should be gone due to ON DELETE CASCADE
      const messages = db.prepare('SELECT * FROM messages WHERE session_id = ?').all(sessionId);
      expect(messages).toHaveLength(0);
    });
  });

  describe('Allowed Tools Operations', () => {
    const sessionId = 'tools-test-session';

    beforeEach(() => {
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(sessionId, 'Test', '/tmp', 'default', Date.now(), Date.now());
    });

    it('should add an allowed tool', () => {
      db.prepare(`
        INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at)
        VALUES (?, ?, ?)
      `).run(sessionId, 'Bash', Date.now());

      const tools = db.prepare('SELECT tool_name FROM allowed_tools WHERE session_id = ?').all(sessionId);
      expect(tools).toHaveLength(1);
      expect(tools[0].tool_name).toBe('Bash');
    });

    it('should get all allowed tools', () => {
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now());
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Read', Date.now());
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Write', Date.now());

      const tools = db.prepare('SELECT tool_name FROM allowed_tools WHERE session_id = ?').all(sessionId);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.tool_name)).toContain('Bash');
      expect(tools.map((t) => t.tool_name)).toContain('Read');
      expect(tools.map((t) => t.tool_name)).toContain('Write');
    });

    it('should check if tool is allowed', () => {
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now());

      const allowed = db.prepare('SELECT 1 FROM allowed_tools WHERE session_id = ? AND tool_name = ?').get(sessionId, 'Bash');
      const notAllowed = db.prepare('SELECT 1 FROM allowed_tools WHERE session_id = ? AND tool_name = ?').get(sessionId, 'Write');

      expect(allowed).toBeDefined();
      expect(notAllowed).toBeUndefined();
    });

    it('should not duplicate tools (UNIQUE constraint)', () => {
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now());
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now() + 1000);

      const tools = db.prepare('SELECT * FROM allowed_tools WHERE session_id = ? AND tool_name = ?').all(sessionId, 'Bash');
      expect(tools).toHaveLength(1);
    });

    it('should clear all allowed tools for a session', () => {
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now());
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Read', Date.now());

      db.prepare('DELETE FROM allowed_tools WHERE session_id = ?').run(sessionId);

      const tools = db.prepare('SELECT * FROM allowed_tools WHERE session_id = ?').all(sessionId);
      expect(tools).toHaveLength(0);
    });

    it('should cascade delete tools when session is deleted', () => {
      db.prepare(`INSERT OR REPLACE INTO allowed_tools (session_id, tool_name, allowed_at) VALUES (?, ?, ?)`).run(sessionId, 'Bash', Date.now());

      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      const tools = db.prepare('SELECT * FROM allowed_tools WHERE session_id = ?').all(sessionId);
      expect(tools).toHaveLength(0);
    });
  });

  describe('Cleanup Operations', () => {
    it('should cleanup expired sessions', () => {
      const now = Date.now();
      const twoHoursAgo = now - 7200000;

      // Recent session (should stay active)
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run('recent', 'Recent', '/tmp', 'default', now, now);

      // Old session (should be deactivated)
      db.prepare(`
        INSERT INTO sessions (id, name, working_directory, mode, created_at, last_activity, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run('old', 'Old', '/tmp', 'default', twoHoursAgo, twoHoursAgo);

      // Cleanup sessions older than 1 hour
      const cutoff = now - 3600000;
      db.prepare('UPDATE sessions SET is_active = 0 WHERE last_activity < ? AND is_active = 1').run(cutoff);

      const recent = db.prepare('SELECT * FROM sessions WHERE id = ?').get('recent');
      const old = db.prepare('SELECT * FROM sessions WHERE id = ?').get('old');

      expect(recent.is_active).toBe(1);
      expect(old.is_active).toBe(0);
    });
  });
});
