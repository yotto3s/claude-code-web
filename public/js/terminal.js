// Terminal Manager using xterm.js

class TerminalManager {
  constructor() {
    this.terminal = null;
    this.fitAddon = null;
    this.terminalId = null;
    this.isConnected = false;
    this.sendCallback = null;
    this.resizeTimeout = null;
  }

  initialize(container, sendCallback) {
    if (this.terminal) {
      return; // Already initialized
    }

    this.sendCallback = sendCallback;

    // Create terminal instance
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#eaeaea',
        cursor: '#eaeaea',
        black: '#1a1a2e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#e879f9',
        cyan: '#22d3ee',
        white: '#eaeaea',
        brightBlack: '#6b7280',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fcd34d',
        brightBlue: '#93c5fd',
        brightMagenta: '#f0abfc',
        brightCyan: '#67e8f9',
        brightWhite: '#f9fafb'
      },
      allowTransparency: true,
      scrollback: 10000
    });

    // Create fit addon for responsive sizing
    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // Open terminal in container
    this.terminal.open(container);
    this.fitAddon.fit();

    // Handle terminal input
    this.terminal.onData(data => {
      if (this.isConnected && this.sendCallback) {
        this.sendCallback({
          type: 'terminal_input',
          terminalId: this.terminalId,
          data: data
        });
      }
    });

    // Handle terminal resize
    this.terminal.onResize(({ cols, rows }) => {
      if (this.isConnected && this.sendCallback) {
        // Debounce resize events
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
          this.sendCallback({
            type: 'terminal_resize',
            terminalId: this.terminalId,
            cols: cols,
            rows: rows
          });
        }, 100);
      }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fit();
    });

    console.log('Terminal initialized');
  }

  createTerminal(terminalId, cwd) {
    if (!this.sendCallback) {
      console.error('Terminal not initialized');
      return;
    }

    this.terminalId = terminalId;
    
    this.sendCallback({
      type: 'terminal_create',
      terminalId: terminalId,
      cwd: cwd
    });

    console.log('Creating terminal:', terminalId);
  }

  handleData(data) {
    if (this.terminal) {
      this.terminal.write(data);
    }
  }

  handleCreated(terminalId) {
    this.terminalId = terminalId;
    this.isConnected = true;
    console.log('Terminal created:', terminalId);
    
    // Write welcome message
    this.terminal.writeln('\x1b[1;32m● Terminal connected\x1b[0m');
    
    // Fit terminal to container
    this.fit();
  }

  handleExit(exitCode, signal) {
    this.isConnected = false;
    console.log('Terminal exited:', { exitCode, signal });
    
    this.terminal.writeln('');
    this.terminal.writeln(`\x1b[1;31m● Terminal process exited (code: ${exitCode || signal})\x1b[0m`);
  }

  handleClosed() {
    this.isConnected = false;
    this.terminalId = null;
    console.log('Terminal closed');
  }

  fit() {
    if (this.fitAddon && this.terminal) {
      try {
        this.fitAddon.fit();
      } catch (err) {
        console.error('Error fitting terminal:', err);
      }
    }
  }

  clear() {
    if (this.terminal) {
      this.terminal.clear();
    }
  }

  focus() {
    if (this.terminal) {
      this.terminal.focus();
    }
  }

  close() {
    if (this.terminalId && this.sendCallback) {
      this.sendCallback({
        type: 'terminal_close',
        terminalId: this.terminalId
      });
    }
  }

  destroy() {
    if (this.terminal) {
      this.close();
      this.terminal.dispose();
      this.terminal = null;
    }
    
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    this.fitAddon = null;
    this.terminalId = null;
    this.isConnected = false;
    this.sendCallback = null;
  }
}
