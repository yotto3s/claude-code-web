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
const path = require('path');

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
   * @param {string} sessionId - Unique session identifier
   * @param {string} [cwd] - Working directory for the terminal
   * @param {string} [username] - Username for the session
   */
  constructor(sessionId, cwd, username) {
    super();
    this.sessionId = sessionId;
    this.cwd = cwd || process.cwd();
    this.username = username;
    this.ptyProcess = null;
    this.isActive = true;
    this.lastActivity = Date.now();
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
      STARSHIP_CACHE: '/tmp/starship'
    });

    // Use login shell to ensure profile is sourced
    const shellArgs = shell.includes('bash') ? ['-l'] : [];

    this.ptyProcess = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: env
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
      } catch (err) {
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
    /** @type {Map<string, TerminalSession>} Map of session ID to terminal */
    this.terminals = new Map();
    /** @type {number} Session timeout in ms (30 minutes) */
    this.sessionTimeoutMs = 30 * 60 * 1000;
    /** @type {number} Cleanup check interval in ms (5 minutes) */
    this.cleanupIntervalMs = 5 * 60 * 1000;

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupIntervalMs);
  }

  createTerminal(sessionId, cwd, username) {
    const terminal = new TerminalSession(sessionId, cwd, username);
    this.terminals.set(sessionId, terminal);
    
    terminal.on('cleanup', () => {
      this.terminals.delete(sessionId);
    });

    console.log(`Terminal created for session ${sessionId} in ${cwd}`);
    return terminal;
  }

  getTerminal(sessionId) {
    return this.terminals.get(sessionId);
  }

  terminateSession(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.destroy();
      this.terminals.delete(sessionId);
      console.log(`Terminal session ${sessionId} terminated`);
      return true;
    }
    return false;
  }

  cleanupInactiveSessions() {
    const now = Date.now();
    const sessionsToRemove = [];

    for (const [sessionId, terminal] of this.terminals.entries()) {
      if (now - terminal.lastActivity > this.sessionTimeoutMs) {
        sessionsToRemove.push(sessionId);
      }
    }

    for (const sessionId of sessionsToRemove) {
      console.log(`Cleaning up inactive terminal session: ${sessionId}`);
      this.terminateSession(sessionId);
    }
  }

  listSessions() {
    return Array.from(this.terminals.values()).map(terminal => ({
      sessionId: terminal.sessionId,
      cwd: terminal.cwd,
      username: terminal.username,
      isActive: terminal.isActive,
      lastActivity: terminal.lastActivity
    }));
  }

  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const [sessionId, terminal] of this.terminals.entries()) {
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
