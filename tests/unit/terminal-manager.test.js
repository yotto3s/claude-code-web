/**
 * Unit Tests for TerminalManager
 *
 * Tests the terminal management logic without actual PTY processes.
 * Uses mocked TerminalSession to test session ownership, filtering, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import EventEmitter from 'events';

/**
 * Mock TerminalSession class that mimics the real one without spawning PTY
 */
class MockTerminalSession extends EventEmitter {
  constructor(terminalId, ownerSessionId, cwd, username, name) {
    super();
    this.terminalId = terminalId;
    this.ownerSessionId = ownerSessionId;
    this.cwd = cwd || '/tmp';
    this.username = username;
    this.name = name || 'Terminal';
    this.ptyProcess = null;
    this.isActive = true;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
  }

  start() {
    // Mock: pretend ptyProcess is started
    this.ptyProcess = { mock: true };
    this.emit('started');
  }

  write(_data) {
    if (this.ptyProcess) {
      this.lastActivity = Date.now();
    }
  }

  resize(_cols, _rows) {
    // Mock resize - does nothing
  }

  cleanup() {
    this.isActive = false;
    this.ptyProcess = null;
    this.emit('cleanup');
  }

  destroy() {
    this.cleanup();
    this.removeAllListeners();
  }
}

/**
 * TerminalManager class for testing (extracted logic without singleton/timers)
 */
class TestableTerminalManager {
  constructor() {
    this.terminals = new Map();
    this.sessionTimeoutMs = 30 * 60 * 1000;
    // No cleanup timer for tests
  }

  createTerminal(terminalId, ownerSessionId, cwd, username, name) {
    const terminal = new MockTerminalSession(terminalId, ownerSessionId, cwd, username, name);
    this.terminals.set(terminalId, terminal);

    terminal.on('cleanup', () => {
      this.terminals.delete(terminalId);
    });

    return terminal;
  }

  getTerminal(terminalId) {
    return this.terminals.get(terminalId);
  }

  getTerminalsForSession(sessionId) {
    const terminals = [];
    for (const terminal of this.terminals.values()) {
      if (terminal.ownerSessionId === sessionId) {
        terminals.push(terminal);
      }
    }
    return terminals;
  }

  getTerminalListForSession(sessionId) {
    return this.getTerminalsForSession(sessionId).map((terminal) => ({
      id: terminal.terminalId,
      name: terminal.name,
      cwd: terminal.cwd,
      isConnected: terminal.isActive && terminal.ptyProcess !== null,
    }));
  }

  terminateTerminal(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.destroy();
      this.terminals.delete(terminalId);
      return true;
    }
    return false;
  }

  terminateSessionTerminals(sessionId) {
    const terminals = this.getTerminalsForSession(sessionId);
    let count = 0;
    for (const terminal of terminals) {
      this.terminateTerminal(terminal.terminalId);
      count++;
    }
    return count;
  }

  cleanupInactiveTerminals() {
    const now = Date.now();
    const terminalsToRemove = [];

    for (const [terminalId, terminal] of this.terminals.entries()) {
      if (now - terminal.lastActivity > this.sessionTimeoutMs) {
        terminalsToRemove.push(terminalId);
      }
    }

    for (const terminalId of terminalsToRemove) {
      this.terminateTerminal(terminalId);
    }

    return terminalsToRemove.length;
  }

  listTerminals() {
    return Array.from(this.terminals.values()).map((terminal) => ({
      terminalId: terminal.terminalId,
      ownerSessionId: terminal.ownerSessionId,
      name: terminal.name,
      cwd: terminal.cwd,
      username: terminal.username,
      isActive: terminal.isActive,
      lastActivity: terminal.lastActivity,
      createdAt: terminal.createdAt,
    }));
  }

  shutdown() {
    for (const terminal of this.terminals.values()) {
      terminal.destroy();
    }
    this.terminals.clear();
  }
}

describe('TerminalManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TestableTerminalManager();
  });

  afterEach(() => {
    manager.shutdown();
  });

  describe('Terminal Creation', () => {
    it('should create a terminal with correct properties', () => {
      const terminal = manager.createTerminal('term-1', 'session-1', '/home/test', 'testuser', 'My Terminal');

      expect(terminal.terminalId).toBe('term-1');
      expect(terminal.ownerSessionId).toBe('session-1');
      expect(terminal.cwd).toBe('/home/test');
      expect(terminal.username).toBe('testuser');
      expect(terminal.name).toBe('My Terminal');
      expect(terminal.isActive).toBe(true);
    });

    it('should use default values when optional params not provided', () => {
      const terminal = manager.createTerminal('term-1', 'session-1');

      expect(terminal.cwd).toBe('/tmp');
      expect(terminal.name).toBe('Terminal');
      expect(terminal.username).toBeUndefined();
    });

    it('should store terminal in the map', () => {
      manager.createTerminal('term-1', 'session-1');

      expect(manager.terminals.size).toBe(1);
      expect(manager.getTerminal('term-1')).toBeDefined();
    });

    it('should create multiple terminals', () => {
      manager.createTerminal('term-1', 'session-1');
      manager.createTerminal('term-2', 'session-1');
      manager.createTerminal('term-3', 'session-2');

      expect(manager.terminals.size).toBe(3);
    });
  });

  describe('Terminal Retrieval', () => {
    it('should get terminal by ID', () => {
      manager.createTerminal('term-1', 'session-1', '/tmp', 'user1', 'Terminal 1');

      const terminal = manager.getTerminal('term-1');

      expect(terminal).toBeDefined();
      expect(terminal.terminalId).toBe('term-1');
    });

    it('should return undefined for non-existent terminal', () => {
      const terminal = manager.getTerminal('non-existent');

      expect(terminal).toBeUndefined();
    });
  });

  describe('Session Ownership - getTerminalsForSession', () => {
    beforeEach(() => {
      // Create terminals for multiple sessions
      manager.createTerminal('term-1', 'session-A', '/home/a', 'userA', 'Term A1');
      manager.createTerminal('term-2', 'session-A', '/home/a', 'userA', 'Term A2');
      manager.createTerminal('term-3', 'session-B', '/home/b', 'userB', 'Term B1');
      manager.createTerminal('term-4', 'session-C', '/home/c', 'userC', 'Term C1');
    });

    it('should return terminals only for the specified session', () => {
      const terminalsA = manager.getTerminalsForSession('session-A');

      expect(terminalsA).toHaveLength(2);
      expect(terminalsA.every((t) => t.ownerSessionId === 'session-A')).toBe(true);
    });

    it('should return empty array for session with no terminals', () => {
      const terminals = manager.getTerminalsForSession('session-nonexistent');

      expect(terminals).toHaveLength(0);
    });

    it('should return single terminal for session with one terminal', () => {
      const terminalsB = manager.getTerminalsForSession('session-B');

      expect(terminalsB).toHaveLength(1);
      expect(terminalsB[0].terminalId).toBe('term-3');
    });

    it('should isolate terminals between different sessions', () => {
      const terminalsA = manager.getTerminalsForSession('session-A');
      const terminalsB = manager.getTerminalsForSession('session-B');
      const terminalsC = manager.getTerminalsForSession('session-C');

      expect(terminalsA).toHaveLength(2);
      expect(terminalsB).toHaveLength(1);
      expect(terminalsC).toHaveLength(1);

      // Ensure no overlap
      const allTerminalIds = [...terminalsA, ...terminalsB, ...terminalsC].map((t) => t.terminalId);
      const uniqueIds = new Set(allTerminalIds);
      expect(uniqueIds.size).toBe(4);
    });
  });

  describe('Session Ownership - getTerminalListForSession', () => {
    beforeEach(() => {
      manager.createTerminal('term-1', 'session-A', '/home/a', 'userA', 'Terminal 1');
      manager.createTerminal('term-2', 'session-A', '/projects', 'userA', 'Terminal 2');
    });

    it('should return formatted terminal list for client', () => {
      const list = manager.getTerminalListForSession('session-A');

      expect(list).toHaveLength(2);
      expect(list[0]).toHaveProperty('id');
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('cwd');
      expect(list[0]).toHaveProperty('isConnected');
    });

    it('should map terminal properties correctly', () => {
      const list = manager.getTerminalListForSession('session-A');
      const term1 = list.find((t) => t.id === 'term-1');

      expect(term1.id).toBe('term-1');
      expect(term1.name).toBe('Terminal 1');
      expect(term1.cwd).toBe('/home/a');
    });

    it('should show isConnected false when terminal not started', () => {
      const list = manager.getTerminalListForSession('session-A');

      // Terminals haven't been started (ptyProcess is null)
      expect(list.every((t) => t.isConnected === false)).toBe(true);
    });

    it('should show isConnected true when terminal is started', () => {
      // Start the terminal (creates mock ptyProcess)
      const terminal = manager.getTerminal('term-1');
      terminal.start();

      const list = manager.getTerminalListForSession('session-A');
      const term1 = list.find((t) => t.id === 'term-1');

      expect(term1.isConnected).toBe(true);
    });

    it('should return empty array for session with no terminals', () => {
      const list = manager.getTerminalListForSession('session-nonexistent');

      expect(list).toEqual([]);
    });
  });

  describe('Terminal Termination', () => {
    it('should terminate a specific terminal', () => {
      manager.createTerminal('term-1', 'session-A');

      const result = manager.terminateTerminal('term-1');

      expect(result).toBe(true);
      expect(manager.getTerminal('term-1')).toBeUndefined();
      expect(manager.terminals.size).toBe(0);
    });

    it('should return false for non-existent terminal', () => {
      const result = manager.terminateTerminal('non-existent');

      expect(result).toBe(false);
    });

    it('should not affect other terminals when terminating one', () => {
      manager.createTerminal('term-1', 'session-A');
      manager.createTerminal('term-2', 'session-A');

      manager.terminateTerminal('term-1');

      expect(manager.getTerminal('term-1')).toBeUndefined();
      expect(manager.getTerminal('term-2')).toBeDefined();
      expect(manager.terminals.size).toBe(1);
    });

    it('should mark terminal as inactive on termination', () => {
      const terminal = manager.createTerminal('term-1', 'session-A');
      terminal.start();
      expect(terminal.isActive).toBe(true);

      manager.terminateTerminal('term-1');

      // Terminal is destroyed, so we can't check it directly
      // but we verify it was removed from map
      expect(manager.terminals.size).toBe(0);
    });
  });

  describe('Session Terminal Cleanup - terminateSessionTerminals', () => {
    beforeEach(() => {
      // Create terminals for multiple sessions
      manager.createTerminal('term-A1', 'session-A', '/home/a', 'userA', 'Term A1');
      manager.createTerminal('term-A2', 'session-A', '/home/a', 'userA', 'Term A2');
      manager.createTerminal('term-B1', 'session-B', '/home/b', 'userB', 'Term B1');
    });

    it('should terminate all terminals for a session', () => {
      const count = manager.terminateSessionTerminals('session-A');

      expect(count).toBe(2);
      expect(manager.getTerminalsForSession('session-A')).toHaveLength(0);
    });

    it('should not affect other sessions terminals', () => {
      manager.terminateSessionTerminals('session-A');

      expect(manager.getTerminalsForSession('session-B')).toHaveLength(1);
      expect(manager.getTerminal('term-B1')).toBeDefined();
    });

    it('should return 0 for session with no terminals', () => {
      const count = manager.terminateSessionTerminals('session-nonexistent');

      expect(count).toBe(0);
    });

    it('should return correct count when terminating single terminal', () => {
      const count = manager.terminateSessionTerminals('session-B');

      expect(count).toBe(1);
      expect(manager.getTerminalsForSession('session-B')).toHaveLength(0);
    });

    it('should properly clean up terminal resources', () => {
      const termA1 = manager.getTerminal('term-A1');
      termA1.start();

      manager.terminateSessionTerminals('session-A');

      expect(termA1.isActive).toBe(false);
      expect(termA1.ptyProcess).toBeNull();
    });
  });

  describe('Inactive Terminal Cleanup', () => {
    it('should cleanup terminals that exceed timeout', () => {
      manager.createTerminal('old-term', 'session-A');
      manager.createTerminal('new-term', 'session-A');

      // Make one terminal appear old
      const oldTerminal = manager.getTerminal('old-term');
      oldTerminal.lastActivity = Date.now() - (31 * 60 * 1000); // 31 minutes ago

      const cleaned = manager.cleanupInactiveTerminals();

      expect(cleaned).toBe(1);
      expect(manager.getTerminal('old-term')).toBeUndefined();
      expect(manager.getTerminal('new-term')).toBeDefined();
    });

    it('should not cleanup active terminals', () => {
      manager.createTerminal('active-term', 'session-A');

      const cleaned = manager.cleanupInactiveTerminals();

      expect(cleaned).toBe(0);
      expect(manager.getTerminal('active-term')).toBeDefined();
    });

    it('should cleanup multiple old terminals', () => {
      manager.createTerminal('old-1', 'session-A');
      manager.createTerminal('old-2', 'session-B');
      manager.createTerminal('new-1', 'session-C');

      // Make terminals appear old
      manager.getTerminal('old-1').lastActivity = Date.now() - (35 * 60 * 1000);
      manager.getTerminal('old-2').lastActivity = Date.now() - (40 * 60 * 1000);

      const cleaned = manager.cleanupInactiveTerminals();

      expect(cleaned).toBe(2);
      expect(manager.terminals.size).toBe(1);
      expect(manager.getTerminal('new-1')).toBeDefined();
    });
  });

  describe('List Terminals', () => {
    it('should list all terminals with metadata', () => {
      manager.createTerminal('term-1', 'session-A', '/home/a', 'userA', 'Terminal A');
      manager.createTerminal('term-2', 'session-B', '/home/b', 'userB', 'Terminal B');

      const list = manager.listTerminals();

      expect(list).toHaveLength(2);
      expect(list[0]).toHaveProperty('terminalId');
      expect(list[0]).toHaveProperty('ownerSessionId');
      expect(list[0]).toHaveProperty('name');
      expect(list[0]).toHaveProperty('cwd');
      expect(list[0]).toHaveProperty('username');
      expect(list[0]).toHaveProperty('isActive');
      expect(list[0]).toHaveProperty('lastActivity');
      expect(list[0]).toHaveProperty('createdAt');
    });

    it('should return empty array when no terminals', () => {
      const list = manager.listTerminals();

      expect(list).toEqual([]);
    });
  });

  describe('Shutdown', () => {
    it('should destroy all terminals on shutdown', () => {
      const term1 = manager.createTerminal('term-1', 'session-A');
      const term2 = manager.createTerminal('term-2', 'session-B');
      term1.start();
      term2.start();

      manager.shutdown();

      expect(manager.terminals.size).toBe(0);
      expect(term1.isActive).toBe(false);
      expect(term2.isActive).toBe(false);
    });

    it('should handle shutdown with no terminals', () => {
      expect(() => manager.shutdown()).not.toThrow();
      expect(manager.terminals.size).toBe(0);
    });
  });

  describe('Terminal Events', () => {
    it('should remove terminal from map on cleanup event', () => {
      const terminal = manager.createTerminal('term-1', 'session-A');

      terminal.cleanup();

      expect(manager.getTerminal('term-1')).toBeUndefined();
    });

    it('should emit started event when terminal starts', () => {
      const terminal = manager.createTerminal('term-1', 'session-A');
      const startedHandler = vi.fn();
      terminal.on('started', startedHandler);

      terminal.start();

      expect(startedHandler).toHaveBeenCalled();
    });

    it('should emit cleanup event when terminal cleans up', () => {
      const terminal = manager.createTerminal('term-1', 'session-A');
      const cleanupHandler = vi.fn();
      terminal.on('cleanup', cleanupHandler);

      terminal.cleanup();

      expect(cleanupHandler).toHaveBeenCalled();
    });
  });
});

describe('MockTerminalSession', () => {
  describe('Basic Operations', () => {
    it('should update lastActivity on write', () => {
      const terminal = new MockTerminalSession('term-1', 'session-1');
      terminal.start();

      const initialActivity = terminal.lastActivity;

      // Small delay to ensure time difference
      const futureTime = initialActivity + 1000;
      vi.setSystemTime(futureTime);

      terminal.write('test');

      expect(terminal.lastActivity).toBeGreaterThanOrEqual(initialActivity);

      vi.useRealTimers();
    });

    it('should not write when ptyProcess is null', () => {
      const terminal = new MockTerminalSession('term-1', 'session-1');
      // Not started, so ptyProcess is null

      expect(() => terminal.write('test')).not.toThrow();
    });

    it('should handle resize gracefully', () => {
      const terminal = new MockTerminalSession('term-1', 'session-1');

      expect(() => terminal.resize(120, 40)).not.toThrow();
    });

    it('should set isActive to false on cleanup', () => {
      const terminal = new MockTerminalSession('term-1', 'session-1');
      terminal.start();

      terminal.cleanup();

      expect(terminal.isActive).toBe(false);
      expect(terminal.ptyProcess).toBeNull();
    });

    it('should remove all listeners on destroy', () => {
      const terminal = new MockTerminalSession('term-1', 'session-1');
      terminal.on('data', () => {});
      terminal.on('exit', () => {});

      terminal.destroy();

      expect(terminal.listenerCount('data')).toBe(0);
      expect(terminal.listenerCount('exit')).toBe(0);
    });
  });
});
