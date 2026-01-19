// Main Application

class App {
  constructor() {
    this.chatUI = null;
    this.ws = null;
    this.terminalManager = null;
    this.isProcessing = false;
    this.currentTool = null;
    this.currentBrowserPath = null;  // Will be set after fetching home
    this.currentSessionId = null;
    this.currentWorkingDirectory = null;

    // Mode state management
    this.currentMode = 'default';
    this.modes = ['default', 'acceptEdits', 'plan'];
    this.modeConfig = {
      default: { icon: '&#128221;', label: 'Default', class: '' },
      acceptEdits: { icon: '&#10003;', label: 'Accept Edits', class: 'mode-accept-edits' },
      plan: { icon: '&#128203;', label: 'Plan Mode', class: 'mode-plan' }
    };

    this.init();
  }

  async init() {
    // Initialize UI
    this.chatUI = new ChatUI(document.getElementById('messages'));

    // Initialize Terminal Manager
    this.terminalManager = new TerminalManager();

    // Get DOM elements
    this.elements = {
      statusDot: document.getElementById('status-dot'),
      statusText: document.getElementById('status-text'),
      messageInput: document.getElementById('message-input'),
      sendBtn: document.getElementById('send-btn'),
      sessionsBtn: document.getElementById('sessions-btn'),
      sessionMenu: document.getElementById('session-menu'),
      sessionList: document.getElementById('session-list'),
      newSessionBtn: document.getElementById('new-session-btn'),
      terminalToggleBtn: document.getElementById('terminal-toggle-btn'),
      terminalPanel: document.getElementById('terminal-panel'),
      terminalContainer: document.getElementById('terminal-container'),
      terminalTabs: document.getElementById('terminal-tabs'),
      terminalAddBtn: document.getElementById('terminal-add-btn'),
      terminalCloseBtn: document.getElementById('terminal-close-btn'),
      appContainer: document.querySelector('.app-container'),
      // Modal elements
      modal: document.getElementById('new-session-modal'),
      modalClose: document.getElementById('modal-close'),
      modalCancel: document.getElementById('modal-cancel'),
      modalCreate: document.getElementById('modal-create'),
      workingDirectory: document.getElementById('working-directory'),
      browseBtn: document.getElementById('browse-btn'),
      directoryBrowser: document.getElementById('directory-browser'),
      browserUp: document.getElementById('browser-up'),
      browserPath: document.getElementById('browser-path'),
      browserList: document.getElementById('browser-list'),
      // Session picker elements
      sessionPicker: document.getElementById('session-picker'),
      sessionPickerList: document.getElementById('session-picker-list'),
      sessionPickerNew: document.getElementById('session-picker-new'),
      logoutBtn: document.getElementById('logout-btn'),
      // Mode toggle button
      modeToggleBtn: document.getElementById('mode-toggle-btn')
    };

    // Setup event listeners
    this.setupEventListeners();

    // Fetch home directory for browser first
    await this.fetchHomeDirectory();

    // Connect WebSocket
    await this.connectWebSocket();
  }

  setupEventListeners() {
    // Send message
    this.elements.sendBtn.addEventListener('click', () => this.sendMessage());

    // Textarea handling
    this.elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    this.elements.messageInput.addEventListener('input', () => {
      this.autoResizeTextarea();
    });

    // Session dropdown
    this.elements.sessionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSessionMenu();
    });

    document.addEventListener('click', () => {
      this.elements.sessionMenu.classList.remove('show');
    });

    // New session - open modal
    this.elements.newSessionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openNewSessionModal();
    });

    // Modal events
    this.elements.modalClose.addEventListener('click', () => this.closeModal());
    this.elements.modalCancel.addEventListener('click', () => this.closeModal());
    this.elements.modalCreate.addEventListener('click', () => this.createNewSession());
    this.elements.modal.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) {
        this.closeModal();
      }
    });

    // Directory browser events
    this.elements.browseBtn.addEventListener('click', () => this.toggleBrowser());
    this.elements.browserUp.addEventListener('click', () => this.navigateUp());

    // Enter key in working directory input
    this.elements.workingDirectory.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.createNewSession();
      }
    });

    // Session picker new button
    this.elements.sessionPickerNew.addEventListener('click', () => {
      this.hideSessionPicker();
      this.openNewSessionModal();
    });

    // Terminal toggle button
    this.elements.terminalToggleBtn.addEventListener('click', () => this.toggleTerminal());

    // Terminal close button
    this.elements.terminalCloseBtn.addEventListener('click', () => this.closeTerminal());

    // Terminal add button
    if (this.elements.terminalAddBtn) {
      this.elements.terminalAddBtn.addEventListener('click', () => this.createNewTerminal());
    }

    // Logout button
    if (this.elements.logoutBtn) {
      this.elements.logoutBtn.addEventListener('click', () => this.logout());
    }

    // Mode toggle button
    if (this.elements.modeToggleBtn) {
      this.elements.modeToggleBtn.addEventListener('click', () => this.cycleMode());
    }
  }

  autoResizeTextarea() {
    const textarea = this.elements.messageInput;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }

  async fetchHomeDirectory() {
    try {
      const response = await fetch('/api/home');
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json();
      this.currentBrowserPath = data.home;
    } catch (err) {
      console.error('Failed to fetch home directory:', err);
      this.currentBrowserPath = '/';
    }
  }

  async connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocketClient(wsUrl);

    // Setup handlers
    this.ws.on('connected', () => this.onConnected());
    this.ws.on('disconnected', () => this.onDisconnected());
    this.ws.on('auth', (auth) => this.onAuth(auth));
    this.ws.on('session_created', (session) => this.onSessionCreated(session));
    this.ws.on('session_joined', (data) => this.onSessionJoined(data));
    this.ws.on('sessions_list', (sessions) => this.onSessionsList(sessions));
    this.ws.on('message_sent', () => this.onMessageSent());
    this.ws.on('message_start', () => this.onMessageStart());
    this.ws.on('content_start', (data) => this.onContentStart(data));
    this.ws.on('chunk', (data) => this.onChunk(data));
    this.ws.on('content_stop', () => this.onContentStop());
    this.ws.on('complete', () => this.onComplete());
    this.ws.on('result', (data) => this.onResult(data));
    this.ws.on('cancelled', () => this.onCancelled());
    this.ws.on('error', (error) => this.onError(error));
    this.ws.on('text', (text) => this.onText(text));
    this.ws.on('process_closed', (data) => this.onProcessClosed(data));

    // Terminal event handlers
    this.ws.on('terminal_created', (data) => this.onTerminalCreated(data));
    this.ws.on('terminal_data', (data) => this.onTerminalData(data));
    this.ws.on('terminal_exit', (data) => this.onTerminalExit(data));
    this.ws.on('terminal_closed', (data) => this.onTerminalClosed(data));

    // Prompt event handler
    this.ws.on('prompt', (data) => this.onPrompt(data));

    // Permission request handler
    this.ws.on('permission_request', (data) => this.onPermissionRequest(data));

    // Mode changed handler
    this.ws.on('mode_changed', (data) => this.onModeChanged(data));

    try {
      await this.ws.connect();
    } catch (err) {
      console.error('Failed to connect:', err);
      this.setStatus('disconnected', 'Connection failed');
    }
  }

  onConnected() {
    this.setStatus('connected', 'Connected');

    // Load saved session or show session picker
    const savedSessionId = localStorage.getItem('sessionId');
    if (savedSessionId) {
      this.ws.joinSession(savedSessionId);
    } else {
      // Show session picker instead of auto-creating
      this.showSessionPicker();
      this.ws.listSessions();
    }
  }

  onDisconnected() {
    this.setStatus('disconnected', 'Disconnected');
  }

  onAuth(auth) {
    console.log('Authenticated:', auth);
  }

  onSessionCreated(session) {
    console.log('Session created:', session.id);
    localStorage.setItem('sessionId', session.id);
    this.currentSessionId = session.id;
    this.currentWorkingDirectory = session.workingDirectory;
    this.chatUI.clearMessages();
    this.ws.listSessions();

    // Sync mode with new session
    this.syncModeWithServer();

    // If terminal is open, create terminal for new session
    if (this.elements.terminalPanel.classList.contains('show')) {
      this.ensureTerminalForCurrentSession();
    }
  }

  onSessionJoined(data) {
    console.log('Session joined:', data.session.id);
    localStorage.setItem('sessionId', data.session.id);
    this.currentSessionId = data.session.id;
    this.currentWorkingDirectory = data.session.workingDirectory;

    if (data.history && data.history.length > 0) {
      this.chatUI.loadHistory(data.history);
    } else {
      this.chatUI.clearMessages();
    }

    // Sync mode: if session has a mode, use it; otherwise sync our mode to server
    if (data.session.mode) {
      this.setModeUI(data.session.mode);
    } else {
      this.syncModeWithServer();
    }

    this.ws.listSessions();

    // If terminal is open, switch to terminal for this session
    if (this.elements.terminalPanel.classList.contains('show')) {
      this.ensureTerminalForCurrentSession();
    }
  }

  onSessionsList(sessions) {
    this.updateSessionList(sessions);
    // Also update session picker if visible
    if (this.elements.sessionPicker.classList.contains('show')) {
      // If no sessions, show the new session modal instead
      if (sessions.length === 0) {
        this.hideSessionPicker();
        this.openNewSessionModal();
      } else {
        this.renderSessionPicker(sessions);
      }
    }
  }

  onMessageSent() {
    // Message was sent successfully
  }

  onMessageStart() {
    this.chatUI.startAssistantMessage();
    this.isProcessing = true;
    this.updateSendButton();
  }

  onContentStart(data) {
    if (data.contentBlock?.type === 'tool_use') {
      this.currentTool = data.contentBlock.name;
      this.chatUI.showToolUse(this.currentTool);
    }
  }

  onChunk(data) {
    if (!this.currentTool) {
      this.chatUI.appendToAssistantMessage(data.text);
    }
  }

  onContentStop() {
    if (this.currentTool) {
      this.chatUI.removeToolIndicator();
      this.currentTool = null;
    }
  }

  onComplete() {
    this.chatUI.finishAssistantMessage();
    this.chatUI.removePrompt();
    this.isProcessing = false;
    this.updateSendButton();
  }

  onResult(data) {
    // Final result received
    this.chatUI.finishAssistantMessage();
    this.isProcessing = false;
    this.updateSendButton();
  }

  onCancelled() {
    this.chatUI.finishAssistantMessage();
    this.chatUI.removePrompt();
    this.chatUI.showSystemMessage('Response cancelled');
    this.isProcessing = false;
    this.updateSendButton();
  }

  onError(error) {
    this.chatUI.showError(error.message || 'An error occurred');
    this.isProcessing = false;
    this.updateSendButton();
  }

  onText(text) {
    // Plain text output
    this.chatUI.appendToAssistantMessage(text + '\n');
  }

  onProcessClosed(data) {
    if (data.code !== 0) {
      this.chatUI.showSystemMessage(`Claude process exited with code ${data.code}`);
    }
    // Process automatically restarts on server side, no action needed
  }

  onPrompt(data) {
    // Remove tool indicator since we're showing a prompt
    this.chatUI.removeToolIndicator();
    this.currentTool = null;

    // Show the prompt UI
    this.chatUI.showPrompt(data, (requestId, response) => {
      this.ws.sendPromptResponse(requestId, response);
    });
  }

  onPermissionRequest(data) {
    // Remove tool indicator since we're showing a permission prompt
    this.chatUI.removeToolIndicator();
    this.currentTool = null;

    // Show the permission prompt UI
    this.chatUI.showPermissionPrompt(data, (requestId, decision, toolInput) => {
      this.ws.sendPermissionResponse(requestId, decision, toolInput);
    });
  }

  sendMessage() {
    if (this.isProcessing) {
      // Cancel current operation
      this.ws.cancel();
      return;
    }

    const content = this.elements.messageInput.value.trim();
    if (!content) return;

    // Add user message to UI
    this.chatUI.addUserMessage(content);

    // Clear input
    this.elements.messageInput.value = '';
    this.autoResizeTextarea();

    // Send via WebSocket
    this.ws.sendMessage(content);
  }

  updateSendButton() {
    const btn = this.elements.sendBtn;

    if (this.isProcessing) {
      btn.classList.add('cancel-btn');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="6" width="12" height="12"/>
        </svg>
      `;
      btn.title = 'Cancel';
    } else {
      btn.classList.remove('cancel-btn');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      `;
      btn.title = 'Send';
    }
  }

  setStatus(status, text) {
    this.elements.statusDot.className = 'status-dot' + (status === 'connected' ? ' connected' : '');
    this.elements.statusText.textContent = text;
  }

  toggleSessionMenu() {
    this.elements.sessionMenu.classList.toggle('show');
    if (this.elements.sessionMenu.classList.contains('show')) {
      this.ws.listSessions();
    }
  }

  updateSessionList(sessions) {
    const currentId = localStorage.getItem('sessionId');
    const list = this.elements.sessionList;
    list.innerHTML = '';

    if (sessions.length === 0) {
      list.innerHTML = '<div class="session-menu-item">No active sessions</div>';
      return;
    }

    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-menu-item' + (session.id === currentId ? ' active' : '');

      const created = new Date(session.createdAt);
      const timeStr = created.toLocaleTimeString();

      item.innerHTML = `
        <span>Session (${timeStr})</span>
        <span style="font-size: 0.75rem; color: var(--text-secondary);">
          ${session.historyLength} messages
        </span>
      `;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.switchSession(session.id);
      });

      list.appendChild(item);
    }
  }

  switchSession(sessionId) {
    this.elements.sessionMenu.classList.remove('show');
    this.ws.joinSession(sessionId);
  }

  createNewSession() {
    const workingDirectory = this.elements.workingDirectory.value.trim();
    this.closeModal();
    this.elements.sessionMenu.classList.remove('show');
    localStorage.removeItem('sessionId');
    this.ws.createSession(workingDirectory || undefined);
  }

  // Modal methods
  openNewSessionModal() {
    this.elements.sessionMenu.classList.remove('show');
    this.elements.workingDirectory.value = this.currentBrowserPath || '';
    this.elements.directoryBrowser.classList.remove('show');
    this.elements.modal.classList.add('show');
    this.elements.workingDirectory.focus();
  }

  closeModal() {
    this.elements.modal.classList.remove('show');
    this.elements.directoryBrowser.classList.remove('show');
  }

  toggleBrowser() {
    const browser = this.elements.directoryBrowser;
    if (browser.classList.contains('show')) {
      browser.classList.remove('show');
    } else {
      browser.classList.add('show');
      this.loadDirectory(this.currentBrowserPath || '/');
    }
  }

  async loadDirectory(path) {
    const list = this.elements.browserList;
    list.innerHTML = '<div class="browser-loading">Loading...</div>';
    this.elements.browserPath.textContent = path;
    this.elements.browserUp.disabled = path === '/';

    try {
      const response = await fetch(`/api/directories?path=${encodeURIComponent(path)}`);

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load directory');
      }

      this.currentBrowserPath = data.path;
      this.elements.browserPath.textContent = data.path;
      this.elements.browserUp.disabled = data.path === '/';

      if (data.directories.length === 0) {
        list.innerHTML = '<div class="browser-empty">No subdirectories</div>';
        return;
      }

      list.innerHTML = '';
      for (const dir of data.directories) {
        const item = document.createElement('div');
        item.className = 'browser-item';
        item.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>${dir.name}</span>
        `;
        item.addEventListener('click', () => this.selectDirectory(dir.path));
        item.addEventListener('dblclick', () => {
          this.elements.workingDirectory.value = dir.path;
          this.elements.directoryBrowser.classList.remove('show');
        });
        list.appendChild(item);
      }
    } catch (err) {
      list.innerHTML = `<div class="browser-error">${err.message}</div>`;
    }
  }

  selectDirectory(path) {
    this.elements.workingDirectory.value = path;
    this.loadDirectory(path);
  }

  navigateUp() {
    if (this.currentBrowserPath === '/') return;
    const parent = this.currentBrowserPath.split('/').slice(0, -1).join('/') || '/';
    this.loadDirectory(parent);
  }

  // Session picker methods
  showSessionPicker() {
    this.elements.sessionPicker.classList.add('show');
    this.elements.sessionPickerList.innerHTML = '<div class="session-picker-loading">Loading sessions...</div>';
  }

  hideSessionPicker() {
    this.elements.sessionPicker.classList.remove('show');
  }

  renderSessionPicker(sessions) {
    const list = this.elements.sessionPickerList;

    if (sessions.length === 0) {
      list.innerHTML = '<div class="session-picker-empty">No existing sessions.<br>Create a new session to get started.</div>';
      return;
    }

    list.innerHTML = '';
    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-picker-item';

      const created = new Date(session.createdAt);
      const dateStr = created.toLocaleDateString();
      const timeStr = created.toLocaleTimeString();

      item.innerHTML = `
        <div class="session-picker-item-header">
          <span class="session-picker-item-time">${dateStr} ${timeStr}</span>
          <span class="session-picker-item-messages">${session.historyLength} messages</span>
        </div>
        ${session.workingDirectory ? `<span class="session-picker-item-dir">${session.workingDirectory}</span>` : ''}
      `;

      item.addEventListener('click', () => {
        this.hideSessionPicker();
        this.ws.joinSession(session.id);
      });

      list.appendChild(item);
    }
  }

  // Terminal methods
  toggleTerminal() {
    const isVisible = this.elements.terminalPanel.classList.contains('show');

    if (isVisible) {
      this.closeTerminal();
    } else {
      this.openTerminal();
    }
  }

  openTerminal() {
    if (!this.currentSessionId) {
      this.chatUI.showError('Please create or join a session first');
      return;
    }

    this.elements.terminalPanel.classList.add('show');
    this.elements.terminalToggleBtn.classList.add('active');
    this.elements.appContainer.classList.add('terminal-open');

    // Initialize terminal manager if not already done
    if (!this.terminalManager.container) {
      this.terminalManager.initialize(
        this.elements.terminalContainer,
        this.elements.terminalTabs,
        (msg) => this.ws.send(msg)
      );
    }

    // Create a terminal if none exist, otherwise ensure one is active
    if (this.terminalManager.getTerminalCount() === 0) {
      this.createNewTerminal();
    } else if (!this.terminalManager.activeTerminalId) {
      // Switch to first available terminal
      const firstId = Array.from(this.terminalManager.terminals.keys())[0];
      if (firstId) {
        this.terminalManager.switchToTerminal(firstId);
      }
    }

    // Fit and focus terminal after a short delay
    setTimeout(() => {
      this.terminalManager.fit();
      this.terminalManager.focus();
    }, 100);
  }

  createNewTerminal() {
    if (!this.currentWorkingDirectory) return;

    // Initialize terminal manager if not already done
    if (!this.terminalManager.container) {
      this.terminalManager.initialize(
        this.elements.terminalContainer,
        this.elements.terminalTabs,
        (msg) => this.ws.send(msg)
      );
    }

    this.terminalManager.createTerminal(null, this.currentWorkingDirectory);

    // Fit and focus terminal after a short delay
    setTimeout(() => {
      this.terminalManager.fit();
      this.terminalManager.focus();
    }, 100);
  }

  ensureTerminalForCurrentSession() {
    // This method is kept for backward compatibility but now just opens terminal panel
    if (!this.currentSessionId) return;

    // Create a terminal if none exist
    if (this.terminalManager.getTerminalCount() === 0) {
      this.createNewTerminal();
    } else if (this.terminalManager.activeTerminalId) {
      // Switch to active terminal
      this.terminalManager.switchToTerminal(this.terminalManager.activeTerminalId);
    }

    // Fit and focus terminal after a short delay
    setTimeout(() => {
      this.terminalManager.fit();
      this.terminalManager.focus();
    }, 100);
  }

  closeTerminal() {
    this.elements.terminalPanel.classList.remove('show');
    this.elements.terminalToggleBtn.classList.remove('active');
    this.elements.appContainer.classList.remove('terminal-open');
  }

  // Mode management methods
  cycleMode() {
    const currentIndex = this.modes.indexOf(this.currentMode);
    const nextIndex = (currentIndex + 1) % this.modes.length;
    const nextMode = this.modes[nextIndex];
    this.setMode(nextMode);
  }

  setMode(mode) {
    if (!this.modeConfig[mode]) return;

    this.currentMode = mode;
    this.setModeUI(mode);

    // Persist to sessionStorage
    sessionStorage.setItem('claudeMode', mode);

    // Send to server if connected
    if (this.ws && this.ws.isConnected() && this.currentSessionId) {
      this.ws.send('set_mode', { mode });
    }
  }

  setModeUI(mode) {
    if (!this.modeConfig[mode]) return;

    this.currentMode = mode;
    const config = this.modeConfig[mode];
    const btn = this.elements.modeToggleBtn;

    if (btn) {
      // Update button content
      btn.querySelector('.mode-icon').innerHTML = config.icon;
      btn.querySelector('.mode-label').textContent = config.label;
      btn.title = `Current Mode: ${config.label}`;

      // Update button class
      btn.className = 'mode-btn';
      if (config.class) {
        btn.classList.add(config.class);
      }
    }

    // Update sessionStorage
    sessionStorage.setItem('claudeMode', mode);
  }

  syncModeWithServer() {
    // Restore mode from sessionStorage or default
    const savedMode = sessionStorage.getItem('claudeMode');
    if (savedMode && this.modeConfig[savedMode]) {
      this.setMode(savedMode);
    } else {
      this.setMode('default');
    }
  }

  onModeChanged(data) {
    // Server confirmed mode change
    if (data.mode && this.modeConfig[data.mode]) {
      this.setModeUI(data.mode);
    }
  }

  async logout() {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        // Clear local storage
        localStorage.removeItem('sessionId');
        // Redirect to login page
        window.location.href = '/login';
      } else {
        console.error('Logout failed');
      }
    } catch (err) {
      console.error('Logout error:', err);
    }
  }

  onTerminalCreated(data) {
    console.log('Terminal created:', data);
    this.terminalManager.handleCreated(data.terminalId);
  }

  onTerminalData(data) {
    this.terminalManager.handleData(data);
  }

  onTerminalExit(data) {
    this.terminalManager.handleExit(data.terminalId, data.exitCode, data.signal);
  }

  onTerminalClosed(data) {
    console.log('Terminal closed:', data);
    this.terminalManager.handleClosed(data.terminalId);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
