// Terminal Manager using xterm.js

class TerminalManager {
  constructor() {
    this.terminals = new Map(); // Store multiple terminal instances
    this.container = null;
    this.sendCallback = null;
    this.activeTerminalId = null;
  }

  initialize(container, sendCallback) {
    this.container = container;
    this.sendCallback = sendCallback;
    console.log('Terminal manager initialized');
  }

  createTerminal(terminalId, cwd) {
    if (!this.sendCallback) {
      console.error('Terminal not initialized');
      return;
    }

    // Check if terminal already exists
    if (this.terminals.has(terminalId)) {
      console.log('Terminal already exists:', terminalId);
      this.switchToTerminal(terminalId);
      return;
    }

    console.log('Creating new terminal:', terminalId);

    console.log('Creating new terminal:', terminalId);

    // Create terminal instance
    const terminal = new Terminal({
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
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    // Store terminal data
    const terminalData = {
      terminal: terminal,
      fitAddon: fitAddon,
      id: terminalId,
      isConnected: false,
      resizeTimeout: null
    };

    this.terminals.set(terminalId, terminalData);

    // Handle terminal input
    terminal.onData(data => {
      if (terminalData.isConnected && this.sendCallback) {
        this.sendCallback({
          type: 'terminal_input',
          terminalId: terminalId,
          data: data
        });
      }
    });

    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      if (terminalData.isConnected && this.sendCallback) {
        clearTimeout(terminalData.resizeTimeout);
        terminalData.resizeTimeout = setTimeout(() => {
          this.sendCallback({
            type: 'terminal_resize',
            terminalId: terminalId,
            cols: cols,
            rows: rows
          });
        }, 100);
      }
    });

    // Request terminal creation from server
    this.sendCallback({
      type: 'terminal_create',
      terminalId: terminalId,
      cwd: cwd
    });
  }

  switchToTerminal(terminalId) {
    const terminalData = this.terminals.get(terminalId);
    if (!terminalData) {
      console.error('Terminal not found:', terminalId);
      return;
    }

    // Hide current terminal if any
    if (this.activeTerminalId && this.activeTerminalId !== terminalId) {
      const currentData = this.terminals.get(this.activeTerminalId);
      if (currentData && currentData.terminal.element) {
        currentData.terminal.element.style.display = 'none';
      }
    }

    // Show and attach new terminal
    if (!terminalData.terminal.element) {
      terminalData.terminal.open(this.container);
      terminalData.fitAddon.fit();
    } else {
      terminalData.terminal.element.style.display = 'block';
      terminalData.fitAddon.fit();
    }

    this.activeTerminalId = terminalId;
    terminalData.terminal.focus();
    
    console.log('Switched to terminal:', terminalId);
  }

  handleData(data) {
    const terminalData = this.terminals.get(data.terminalId || this.activeTerminalId);
    if (terminalData && terminalData.terminal) {
      terminalData.terminal.write(data.data || data);
    }
  }

  handleCreated(terminalId) {
    const terminalData = this.terminals.get(terminalId);
    if (!terminalData) {
      console.error('Terminal data not found:', terminalId);
      return;
    }

    terminalData.isConnected = true;
    console.log('Terminal created:', terminalId);
    
    // Write welcome message
    terminalData.terminal.writeln('\x1b[1;32m● Terminal connected\x1b[0m');
    
    // Switch to this terminal
    this.switchToTerminal(terminalId);
  }

  handleExit(terminalId, exitCode, signal) {
    const terminalData = this.terminals.get(terminalId);
    if (!terminalData) return;

    terminalData.isConnected = false;
    console.log('Terminal exited:', { terminalId, exitCode, signal });
    
    terminalData.terminal.writeln('');
    terminalData.terminal.writeln(`\x1b[1;31m● Terminal process exited (code: ${exitCode || signal})\x1b[0m`);
  }

  handleClosed(terminalId) {
    const terminalData = this.terminals.get(terminalId);
    if (!terminalData) return;

    terminalData.isConnected = false;
    console.log('Terminal closed:', terminalId);
  }

  fit() {
    if (this.activeTerminalId) {
      const terminalData = this.terminals.get(this.activeTerminalId);
      if (terminalData && terminalData.fitAddon) {
        try {
          terminalData.fitAddon.fit();
        } catch (err) {
          console.error('Error fitting terminal:', err);
        }
      }
    }
  }

  clear() {
    if (this.activeTerminalId) {
      const terminalData = this.terminals.get(this.activeTerminalId);
      if (terminalData && terminalData.terminal) {
        terminalData.terminal.clear();
      }
    }
  }

  focus() {
    if (this.activeTerminalId) {
      const terminalData = this.terminals.get(this.activeTerminalId);
      if (terminalData && terminalData.terminal) {
        terminalData.terminal.focus();
      }
    }
  }

  closeTerminal(terminalId) {
    if (this.sendCallback) {
      this.sendCallback({
        type: 'terminal_close',
        terminalId: terminalId
      });
    }
  }

  destroyTerminal(terminalId) {
    const terminalData = this.terminals.get(terminalId);
    if (!terminalData) return;

    this.closeTerminal(terminalId);

    if (terminalData.terminal) {
      terminalData.terminal.dispose();
    }

    if (terminalData.resizeTimeout) {
      clearTimeout(terminalData.resizeTimeout);
    }

    this.terminals.delete(terminalId);

    if (this.activeTerminalId === terminalId) {
      this.activeTerminalId = null;
    }

    console.log('Terminal destroyed:', terminalId);
  }

  destroy() {
    for (const [terminalId, terminalData] of this.terminals) {
      if (terminalData.terminal) {
        terminalData.terminal.dispose();
      }
      if (terminalData.resizeTimeout) {
        clearTimeout(terminalData.resizeTimeout);
      }
    }
    
    this.terminals.clear();
    this.activeTerminalId = null;
    this.sendCallback = null;
  }

  hasTerminal(terminalId) {
    return this.terminals.has(terminalId);
  }

  isTerminalConnected(terminalId) {
    const terminalData = this.terminals.get(terminalId);
    return terminalData ? terminalData.isConnected : false;
  }
}
