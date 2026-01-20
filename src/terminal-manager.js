/**
 * Terminal Manager Module
 *
 * PTY terminal management using node-pty.
 *
 * Features:
 * - Creates pseudo-terminals with bash/powershell
 * - Handles terminal input/output streaming
 * - Supports terminal resize operations
 * - Starship prompt integration
 * - Automatic cleanup of inactive terminals (30-minute timeout)
 *
 * @module terminal-manager
 */

const pty = require('node-pty');
const EventEmitter = require('events');
const os = require('os');

/**
 * Represents a single PTY terminal session.
 *
 * @extends EventEmitter
 * @fires TerminalSession#data - Terminal output data
 * @fires TerminalSession#exit - Terminal process exited
 * @fires TerminalSession#started - Terminal started
 * @fires TerminalSession#cleanup - Terminal cleaned up
 */
class TerminalSession extends EventEmitter {
  /**
   * Create a new terminal session.
   *
   * @param {string} terminalId - Unique terminal identifier
   * @param {string} ownerSessionId - The session ID that owns this terminal
   * @param {string} [cwd] - Working directory for the terminal
   * @param {string} [username] - Username for the session
   * @param {string} [name] - Display name for the terminal
   */
  constructor(terminalId, ownerSessionId, cwd, username, name) {
    super();
    this.terminalId = terminalId;
    this.ownerSessionId = ownerSessionId;
    this.cwd = cwd || process.cwd();
    this.username = username;
    this.name = name || 'Terminal';
    this.ptyProcess = null;
    this.isActive = true;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
  }

  start() {
    if (this.ptyProcess) {
      return;
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';

    const env = Object.assign({}, process.env, {
      COLORTERM: 'truecolor',
      TERM: 'xterm-256color',
      BASH_ENV: '/etc/bash.bashrc',
      STARSHIP_CACHE: '/tmp/starship',
    });

    // Use login shell to ensure profile is sourced
    const shellArgs = shell.includes('bash') ? ['-l'] : [];

    this.ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: env,
    });

    this.ptyProcess.onData((data) => {
      this.lastActivity = Date.now();
      this.emit('data', data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('exit', { exitCode, signal });
      this.cleanup();
    });

    this.emit('started');
  }

  write(data) {
    if (this.ptyProcess) {
      this.lastActivity = Date.now();
      this.ptyProcess.write(data);
    }
  }

  resize(cols, rows) {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err) {
        console.error('Error resizing terminal:', err.message);
      }
    }
  }

  cleanup() {
    this.isActive = false;
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Already dead
      }
      this.ptyProcess = null;
    }
    this.emit('cleanup');
  }

  destroy() {
    this.cleanup();
    this.removeAllListeners();
  }
}

/**
 * Manages multiple PTY terminal sessions.
 *
 * @class TerminalManager
 */
class TerminalManager {
  /**
   * Create a new terminal manager.
   * Starts automatic cleanup of inactive sessions every 5 minutes.
   */
  constructor() {
    /** @type {Map<string, TerminalSession>} Map of terminal ID to terminal */
    this.terminals = new Map();
    /** @type {number} Terminal timeout in ms (30 minutes) */
    this.sessionTimeoutMs = 30 * 60 * 1000;
    /** @type {number} Cleanup check interval in ms (5 minutes) */
    this.cleanupIntervalMs = 5 * 60 * 1000;

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveTerminals();
    }, this.cleanupIntervalMs);
  }

  /**
   * Create a new terminal for a session.
   *
   * @param {string} terminalId - Unique terminal identifier
   * @param {string} ownerSessionId - The session ID that owns this terminal
   * @param {string} [cwd] - Working directory for the terminal
   * @param {string} [username] - Username for the session
   * @param {string} [name] - Display name for the terminal
   * @returns {TerminalSession} The created terminal session
   */
  createTerminal(terminalId, ownerSessionId, cwd, username, name) {
    const terminal = new TerminalSession(terminalId, ownerSessionId, cwd, username, name);
    this.terminals.set(terminalId, terminal);

    terminal.on('cleanup', () => {
      this.terminals.delete(terminalId);
    });

    console.log(`Terminal ${terminalId} created for session ${ownerSessionId} in ${cwd}`);
    return terminal;
  }

  /**
   * Get a terminal by its ID.
   *
   * @param {string} terminalId - Terminal ID to look up
   * @returns {TerminalSession|undefined} The terminal session if found
   */
  getTerminal(terminalId) {
    return this.terminals.get(terminalId);
  }

  /**
   * Get all terminals belonging to a specific session.
   *
   * @param {string} sessionId - The owner session ID
   * @returns {TerminalSession[]} Array of terminals for the session
   */
  getTerminalsForSession(sessionId) {
    const terminals = [];
    for (const terminal of this.terminals.values()) {
      if (terminal.ownerSessionId === sessionId) {
        terminals.push(terminal);
      }
    }
    return terminals;
  }

  /**
   * Get terminal info list for a session (for sending to client).
   *
   * @param {string} sessionId - The owner session ID
   * @returns {Array<{id: string, name: string, cwd: string}>} Terminal info list
   */
  getTerminalListForSession(sessionId) {
    return this.getTerminalsForSession(sessionId).map((terminal) => ({
      id: terminal.terminalId,
      name: terminal.name,
      cwd: terminal.cwd,
      isConnected: terminal.isActive && terminal.ptyProcess !== null,
    }));
  }

  /**
   * Terminate a specific terminal.
   *
   * @param {string} terminalId - Terminal ID to terminate
   * @returns {boolean} True if terminal was found and terminated
   */
  terminateTerminal(terminalId) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.destroy();
      this.terminals.delete(terminalId);
      console.log(`Terminal ${terminalId} terminated`);
      return true;
    }
    return false;
  }

  /**
   * Terminate all terminals belonging to a session.
   *
   * @param {string} sessionId - The owner session ID
   * @returns {number} Number of terminals terminated
   */
  terminateSessionTerminals(sessionId) {
    const terminals = this.getTerminalsForSession(sessionId);
    let count = 0;
    for (const terminal of terminals) {
      this.terminateTerminal(terminal.terminalId);
      count++;
    }
    if (count > 0) {
      console.log(`Terminated ${count} terminals for session ${sessionId}`);
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
      console.log(`Cleaning up inactive terminal: ${terminalId}`);
      this.terminateTerminal(terminalId);
    }
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
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const terminal of this.terminals.values()) {
      terminal.destroy();
    }
    this.terminals.clear();
  }
}

const terminalManager = new TerminalManager();

// Graceful shutdown
process.on('SIGTERM', () => {
  terminalManager.shutdown();
});

process.on('SIGINT', () => {
  terminalManager.shutdown();
});

module.exports = { terminalManager, TerminalSession };
