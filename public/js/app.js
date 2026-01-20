// Main Application

class App {
  constructor() {
    this.chatUI = null;
    this.ws = null;
    this.terminalManager = null;
    this.isProcessing = false;
    this.currentTool = null;
    this.currentBrowserPath = null; // Will be set after fetching home
    this.currentSessionId = null;
    this.currentSessionName = null;
    this.currentWorkingDirectory = null;

    // Mode state management
    this.currentMode = 'plan';
    this.modes = ['acceptEdits', 'plan'];
    this.modeConfig = {
      acceptEdits: { icon: '&#10003;', label: 'Accept Edits', class: 'mode-accept-edits' },
      plan: { icon: '&#128203;', label: 'Plan Mode', class: 'mode-plan' },
    };

    // Web search toggle state
    this.webSearchEnabled = false;

    // Child agent tracking
    this.activeAgents = new Map(); // taskId -> agent info
    this.agentTools = new Map(); // taskId -> array of tool executions

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
      // Session name display in header
      sessionNameDisplay: document.getElementById('session-name-display'),
      sessionDivider: document.getElementById('session-divider'),
      // Modal elements
      modal: document.getElementById('new-session-modal'),
      modalClose: document.getElementById('modal-close'),
      modalCancel: document.getElementById('modal-cancel'),
      modalCreate: document.getElementById('modal-create'),
      sessionName: document.getElementById('session-name'),
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
      modeToggleBtn: document.getElementById('mode-toggle-btn'),
      // Web search toggle button
      webSearchToggleBtn: document.getElementById('web-search-toggle-btn'),
      // Agent activity panel elements
      agentsToggleBtn: document.getElementById('agents-toggle-btn'),
      agentsPanel: document.getElementById('agents-panel'),
      agentsList: document.getElementById('agents-list'),
      agentsCloseBtn: document.getElementById('agents-close-btn'),
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

    // Web search toggle button
    if (this.elements.webSearchToggleBtn) {
      this.elements.webSearchToggleBtn.addEventListener('click', () => this.toggleWebSearch());
    }

    // Agent activity panel toggle
    if (this.elements.agentsToggleBtn) {
      this.elements.agentsToggleBtn.addEventListener('click', () => this.toggleAgentsPanel());
    }

    // Agent activity panel close button
    if (this.elements.agentsCloseBtn) {
      this.elements.agentsCloseBtn.addEventListener('click', () => this.closeAgentsPanel());
    }

    // Session name click to rename
    if (this.elements.sessionNameDisplay) {
      this.elements.sessionNameDisplay.addEventListener('click', () => this.renameCurrentSession());
    }

    // Close agents panel when clicking outside
    document.addEventListener('click', (e) => {
      if (
        this.elements.agentsPanel.classList.contains('show') &&
        !this.elements.agentsPanel.contains(e.target) &&
        !this.elements.agentsToggleBtn.contains(e.target)
      ) {
        this.closeAgentsPanel();
      }
    });
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

    // Web search changed handler
    this.ws.on('web_search_changed', (data) => this.onWebSearchChanged(data));

    // Exit plan mode request handler
    this.ws.on('exit_plan_mode_request', (data) => this.onExitPlanModeRequest(data));

    // Child agent event handlers
    this.ws.on('agent_start', (data) => this.onAgentStart(data));
    this.ws.on('task_notification', (data) => this.onTaskNotification(data));
    this.ws.on('agents_list', (data) => this.onAgentsList(data));

    // Session renamed handler
    this.ws.on('session_renamed', (data) => this.onSessionRenamed(data));

    // Session deleted handler
    this.ws.on('session_deleted', (data) => this.onSessionDeleted(data));

    // Session reset handler
    this.ws.on('session_reset', (data) => this.onSessionReset(data));

    // Tool execution handler
    this.ws.on('tool_use', (data) => this.onToolUse(data));

    try {
      await this.ws.connect();
    } catch (err) {
      console.error('Failed to connect:', err);
      this.setStatus('disconnected', 'Connection failed');
    }
  }

  onConnected() {
    this.setStatus('connected', 'Connected');

    // Always show session picker on login for user to select a session
    this.showSessionPicker();
    this.ws.listSessions();
  }

  onDisconnected() {
    this.setStatus('disconnected', 'Disconnected');
  }

  onAuth(auth) {
    console.log('Authenticated:', auth);
  }

  onSessionCreated(session) {
    console.log('Session created:', session.id, session.name);
    localStorage.setItem('sessionId', session.id);
    this.currentSessionId = session.id;
    this.currentSessionName = session.name;
    this.currentWorkingDirectory = session.workingDirectory;
    this.updateSessionNameDisplay();
    this.chatUI.clearMessages();
    this.ws.listSessions();

    // Sync mode with new session
    this.syncModeWithServer();

    // Set session context on terminal manager (clears any existing terminals)
    this.terminalManager.setSession(session.id);

    // If terminal is open, create terminal for new session
    if (this.elements.terminalPanel.classList.contains('show')) {
      this.ensureTerminalForCurrentSession();
    }
  }

  onSessionJoined(data) {
    console.log('Session joined:', data.session.id, data.session.name);
    localStorage.setItem('sessionId', data.session.id);
    this.currentSessionId = data.session.id;
    this.currentSessionName = data.session.name;
    this.currentWorkingDirectory = data.session.workingDirectory;
    this.updateSessionNameDisplay();

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

    // Sync web search state from session
    if (typeof data.session.webSearchEnabled === 'boolean') {
      this.setWebSearchUI(data.session.webSearchEnabled);
    }

    this.ws.listSessions();

    // Set session context on terminal manager (clears any existing terminals)
    this.terminalManager.setSession(data.session.id);

    // Restore terminals from server if any exist for this session
    if (data.terminals && data.terminals.length > 0) {
      // Initialize terminal manager if not already done
      if (!this.terminalManager.container) {
        this.terminalManager.initialize(
          this.elements.terminalContainer,
          this.elements.terminalTabs,
          (msg) => this.ws.send(msg)
        );
      }
      this.terminalManager.restoreTerminals(data.terminals);

      // Show terminal panel if we have terminals
      this.elements.terminalPanel.classList.add('show');
      this.elements.terminalToggleBtn.classList.add('active');
      this.elements.appContainer.classList.add('terminal-open');

      // Fit terminals after a short delay
      setTimeout(() => {
        this.terminalManager.fit();
      }, 100);
    } else if (this.elements.terminalPanel.classList.contains('show')) {
      // Terminal panel was open but no terminals for this session
      // Optionally create a new terminal
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

  onResult(_data) {
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

  onToolUse(data) {
    // Check if this tool belongs to a child agent
    if (data.agentId && this.activeAgents.has(data.agentId)) {
      // Display in the agent panel instead of main chat
      this.showAgentToolExecution(data.agentId, data.name, data.input);
    } else {
      // Display tool execution in the main chat
      this.chatUI.showToolExecution(data.name, data.input);
    }
  }

  showAgentToolExecution(agentId, toolName, toolInput) {
    // Track the tool for this agent
    if (!this.agentTools.has(agentId)) {
      this.agentTools.set(agentId, []);
    }
    this.agentTools.get(agentId).push({
      name: toolName,
      input: toolInput,
      time: new Date(),
    });

    // Re-render if panel is open to show the new tool
    if (this.elements.agentsPanel.classList.contains('show')) {
      this.renderAgentsList();
    }
  }

  sendMessage() {
    if (this.isProcessing) {
      // Cancel current operation
      this.ws.cancel();
      return;
    }

    const content = this.elements.messageInput.value.trim();
    if (!content) return;

    // Add message to UI
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
      const sessionName = session.name || `Session (${timeStr})`;
      const isCurrentSession = session.id === currentId;

      item.innerHTML = `
        <div class="session-menu-item-content">
          <span class="session-menu-item-name" title="${this.escapeHtml(sessionName)}">${this.escapeHtml(sessionName)}</span>
          <span class="session-menu-item-meta">
            <span>${timeStr}</span>
            <span>${session.historyLength} messages</span>
          </span>
        </div>
        ${
          isCurrentSession
            ? `
        <button class="session-reset-btn" title="Reset session (delete and create new)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6"></path>
            <path d="M1 20v-6h6"></path>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        `
            : `
        <button class="session-delete-btn" title="Delete session">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
        `
        }
      `;

      // Click on item to switch session
      item.addEventListener('click', (e) => {
        // Don't switch if clicking the delete or reset button
        if (e.target.closest('.session-delete-btn') || e.target.closest('.session-reset-btn')) {
          return;
        }
        e.stopPropagation();
        this.switchSession(session.id);
      });

      // Delete button click handler
      const deleteBtn = item.querySelector('.session-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteSession(session.id, sessionName);
        });
      }

      // Reset button click handler
      const resetBtn = item.querySelector('.session-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.resetCurrentSession();
        });
      }

      list.appendChild(item);
    }
  }

  switchSession(sessionId) {
    this.elements.sessionMenu.classList.remove('show');
    this.ws.joinSession(sessionId);
  }

  createNewSession() {
    const workingDirectory = this.elements.workingDirectory.value.trim();
    const sessionName = this.elements.sessionName ? this.elements.sessionName.value.trim() : '';
    this.closeModal();
    this.elements.sessionMenu.classList.remove('show');
    localStorage.removeItem('sessionId');
    this.ws.createSession(workingDirectory || undefined, sessionName || undefined);
  }

  // Modal methods
  openNewSessionModal() {
    this.elements.sessionMenu.classList.remove('show');
    if (this.elements.sessionName) {
      this.elements.sessionName.value = '';
    }
    this.elements.workingDirectory.value = this.currentBrowserPath || '';
    this.elements.directoryBrowser.classList.remove('show');
    this.elements.modal.classList.add('show');
    if (this.elements.sessionName) {
      this.elements.sessionName.focus();
    } else {
      this.elements.workingDirectory.focus();
    }
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
    this.elements.sessionPickerList.innerHTML =
      '<div class="session-picker-loading">Loading sessions...</div>';
  }

  hideSessionPicker() {
    this.elements.sessionPicker.classList.remove('show');
  }

  renderSessionPicker(sessions) {
    const list = this.elements.sessionPickerList;

    if (sessions.length === 0) {
      list.innerHTML =
        '<div class="session-picker-empty">No existing sessions.<br>Create a new session to get started.</div>';
      return;
    }

    list.innerHTML = '';
    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-picker-item';

      const created = new Date(session.createdAt);
      const dateStr = created.toLocaleDateString();
      const timeStr = created.toLocaleTimeString();
      const sessionName = session.name || `Session (${timeStr})`;

      item.innerHTML = `
        <div class="session-picker-item-header-row">
          <div class="session-picker-item-name" title="${this.escapeHtml(sessionName)}">${this.escapeHtml(sessionName)}</div>
          <button class="session-delete-btn" title="Delete session">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <div class="session-picker-item-header">
          <span class="session-picker-item-time">${dateStr} ${timeStr}</span>
          <span class="session-picker-item-messages">${session.historyLength} messages</span>
        </div>
        ${session.workingDirectory ? `<span class="session-picker-item-dir">${session.workingDirectory}</span>` : ''}
      `;

      // Click on item to join session (but not if clicking delete button)
      item.addEventListener('click', (e) => {
        if (e.target.closest('.session-delete-btn')) {
          return;
        }
        this.hideSessionPicker();
        this.ws.joinSession(session.id);
      });

      // Delete button click handler
      const deleteBtn = item.querySelector('.session-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteSession(session.id, sessionName);
        });
      }

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

  // Child Agent Activity Panel methods
  toggleAgentsPanel() {
    if (this.elements.agentsPanel.classList.contains('show')) {
      this.closeAgentsPanel();
    } else {
      this.openAgentsPanel();
    }
  }

  openAgentsPanel() {
    this.elements.agentsPanel.classList.add('show');
    this.elements.agentsToggleBtn.classList.add('active');
    // Request fresh agent list
    if (this.ws && this.ws.isConnected()) {
      this.ws.listAgents();
    }
    // Render current agents
    this.renderAgentsList();
    // Start elapsed time updater
    this.startAgentsTimeUpdater();
  }

  closeAgentsPanel() {
    this.elements.agentsPanel.classList.remove('show');
    this.elements.agentsToggleBtn.classList.remove('active');
    // Stop elapsed time updater
    this.stopAgentsTimeUpdater();
  }

  startAgentsTimeUpdater() {
    // Update elapsed time every second while panel is open
    this.agentsTimeInterval = setInterval(() => {
      if (this.elements.agentsPanel.classList.contains('show')) {
        this.updateAgentsElapsedTime();
      }
    }, 1000);
  }

  stopAgentsTimeUpdater() {
    if (this.agentsTimeInterval) {
      clearInterval(this.agentsTimeInterval);
      this.agentsTimeInterval = null;
    }
  }

  updateAgentsElapsedTime() {
    const timeElements = this.elements.agentsList.querySelectorAll('.agent-elapsed-time');
    const now = Date.now();
    timeElements.forEach((el) => {
      const startTime = parseInt(el.dataset.startTime, 10);
      if (startTime) {
        const elapsed = Math.floor((now - startTime) / 1000);
        el.textContent = this.formatElapsedTime(elapsed);
      }
    });
  }

  formatElapsedTime(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  onAgentStart(data) {
    // Add agent to local tracking
    this.activeAgents.set(data.taskId, {
      taskId: data.taskId,
      description: data.description,
      agentType: data.agentType,
      startTime: data.startTime,
      status: 'running',
    });

    // Initialize tools array for this agent
    this.agentTools.set(data.taskId, []);

    // Re-render if panel is open
    if (this.elements.agentsPanel.classList.contains('show')) {
      this.renderAgentsList();
    }
  }

  onTaskNotification(data) {
    // Update agent status
    const agent = this.activeAgents.get(data.taskId);
    if (agent) {
      agent.status = data.status;
      agent.summary = data.summary;
    } else {
      // Agent wasn't tracked (maybe page was reloaded), add it now
      this.activeAgents.set(data.taskId, {
        taskId: data.taskId,
        description: data.description,
        agentType: data.agentType,
        status: data.status,
        summary: data.summary,
      });
    }

    // Re-render if panel is open
    if (this.elements.agentsPanel.classList.contains('show')) {
      this.renderAgentsList();
    }

    // Remove completed agents after a delay (keep visible for a bit)
    if (data.status === 'completed' || data.status === 'failed' || data.status === 'stopped') {
      setTimeout(() => {
        this.activeAgents.delete(data.taskId);
        this.agentTools.delete(data.taskId); // Clean up tools tracking
        if (this.elements.agentsPanel.classList.contains('show')) {
          this.renderAgentsList();
        }
      }, 10000); // Keep visible for 10 seconds
    }
  }

  onAgentsList(agents) {
    // Sync local tracking with server state
    this.activeAgents.clear();
    for (const agent of agents) {
      this.activeAgents.set(agent.taskId, agent);
    }

    // Re-render if panel is open
    if (this.elements.agentsPanel.classList.contains('show')) {
      this.renderAgentsList();
    }
  }

  renderAgentsList() {
    const list = this.elements.agentsList;

    if (this.activeAgents.size === 0) {
      list.innerHTML = '<div class="agents-empty">No active child agents</div>';
      return;
    }

    list.innerHTML = '';
    for (const [taskId, agent] of this.activeAgents) {
      const item = document.createElement('div');
      item.className = 'agent-item';

      const statusClass = agent.status || 'running';
      const statusText = this.getStatusText(agent.status);

      // Short task ID
      const shortId = taskId.substring(0, 8);

      // Agent type label
      const typeLabel = agent.agentType || 'Task';

      // Get tools for this agent
      const tools = this.agentTools.get(taskId) || [];
      const toolsCount = tools.length;

      // Build tools HTML
      let toolsHtml = '';
      if (toolsCount > 0) {
        const toolsListHtml = tools
          .map((tool) => {
            let inputDisplay = '';
            if (tool.input) {
              if (tool.input.command) {
                inputDisplay =
                  this.escapeHtml(tool.input.command.substring(0, 60)) +
                  (tool.input.command.length > 60 ? '...' : '');
              } else if (tool.input.file_path) {
                inputDisplay = this.escapeHtml(tool.input.file_path);
              } else if (tool.input.pattern) {
                inputDisplay = this.escapeHtml(tool.input.pattern);
              } else if (tool.input.query) {
                inputDisplay =
                  this.escapeHtml(tool.input.query.substring(0, 40)) +
                  (tool.input.query.length > 40 ? '...' : '');
              }
            }
            return `
            <div class="agent-tool-item">
              <span class="agent-tool-name">${this.escapeHtml(tool.name)}</span>
              ${inputDisplay ? `<span class="agent-tool-input">${inputDisplay}</span>` : ''}
            </div>
          `;
          })
          .join('');

        toolsHtml = `
          <div class="agent-tools-container">
            <div class="agent-tools-toggle" data-taskid="${taskId}">
              <span class="agent-tools-icon">▶</span>
              <span>Tools (${toolsCount})</span>
            </div>
            <div class="agent-tools-list" id="tools-${taskId}" style="display: none;">
              ${toolsListHtml}
            </div>
          </div>
        `;
      }

      item.innerHTML = `
        <div class="agent-item-header">
          <span class="agent-item-type">${typeLabel}</span>
          <span class="agent-status ${statusClass}">
            <span class="agent-status-dot"></span>
            ${statusText}
          </span>
        </div>
        <div class="agent-item-description">${agent.description || 'Running task...'}</div>
        <div class="agent-item-meta">
          <span class="agent-item-id">${shortId}</span>
          ${agent.startTime ? `<span class="agent-elapsed-time" data-start-time="${agent.startTime}">${this.formatElapsedTime(Math.floor((Date.now() - agent.startTime) / 1000))}</span>` : ''}
        </div>
        ${toolsHtml}
        ${agent.summary ? `<div class="agent-item-summary">${this.escapeHtml(agent.summary)}</div>` : ''}
      `;

      // Add click handler for tools toggle
      const toggle = item.querySelector('.agent-tools-toggle');
      if (toggle) {
        toggle.addEventListener('click', (e) => {
          const tid = e.currentTarget.dataset.taskid;
          const toolsList = document.getElementById(`tools-${tid}`);
          const icon = e.currentTarget.querySelector('.agent-tools-icon');
          if (toolsList) {
            if (toolsList.style.display === 'none') {
              toolsList.style.display = 'block';
              icon.textContent = '▼';
            } else {
              toolsList.style.display = 'none';
              icon.textContent = '▶';
            }
          }
        });
      }

      list.appendChild(item);
    }
  }

  getStatusText(status) {
    switch (status) {
      case 'running':
        return 'Running';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Running';
    }
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
      this.setMode('plan');
    }
  }

  onModeChanged(data) {
    // Server confirmed mode change
    if (data.mode && this.modeConfig[data.mode]) {
      this.setModeUI(data.mode);
    }
  }

  // Web Search Toggle Methods
  toggleWebSearch() {
    const newValue = !this.webSearchEnabled;

    // Send to server
    if (this.ws && this.ws.isConnected() && this.currentSessionId) {
      this.ws.send('set_web_search', { enabled: newValue });
    }
  }

  setWebSearchUI(enabled) {
    this.webSearchEnabled = Boolean(enabled);
    const btn = this.elements.webSearchToggleBtn;

    if (btn) {
      // Update button active state
      btn.classList.toggle('toggle-active', this.webSearchEnabled);
      btn.title = `Web Search: ${this.webSearchEnabled ? 'On' : 'Off'}`;

      // Update label
      const label = btn.querySelector('.toggle-label');
      if (label) {
        label.textContent = this.webSearchEnabled ? 'web on' : 'web';
      }
    }
  }

  onWebSearchChanged(data) {
    // Server confirmed web search change
    this.setWebSearchUI(data.enabled);
  }

  onExitPlanModeRequest(data) {
    // Remove tool indicator since we're showing a prompt
    this.chatUI.removeToolIndicator();
    this.currentTool = null;

    // Show the exit plan mode confirmation prompt
    this.chatUI.showExitPlanModePrompt(data, (requestId, approved) => {
      this.ws.send('exit_plan_mode_response', { requestId, approved });
    });
  }

  async logout() {
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
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
    this.terminalManager.handleCreated(data.terminalId, data.name);
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

  // Session naming methods
  updateSessionNameDisplay() {
    const nameDisplay = this.elements.sessionNameDisplay;
    const divider = this.elements.sessionDivider;

    if (nameDisplay && this.currentSessionName) {
      nameDisplay.textContent = this.currentSessionName;
      nameDisplay.title = `Click to rename: ${this.currentSessionName}`;
      nameDisplay.classList.add('visible');
      if (divider) divider.classList.add('visible');
    } else if (nameDisplay) {
      nameDisplay.textContent = '';
      nameDisplay.classList.remove('visible');
      if (divider) divider.classList.remove('visible');
    }
  }

  onSessionRenamed(data) {
    if (data.sessionId === this.currentSessionId) {
      this.currentSessionName = data.name;
      this.updateSessionNameDisplay();
    }
    // Refresh session list to show updated name
    this.ws.listSessions();
  }

  onSessionDeleted(_data) {
    // Refresh session lists
    this.ws.listSessions();
  }

  onSessionReset(data) {
    // Clear chat and update to new session
    this.chatUI.clearMessages();
    this.currentSessionId = data.session.id;
    this.currentSessionName = data.session.name;
    this.currentWorkingDirectory = data.session.workingDirectory;

    // Update session info display
    const sessionInfo = document.getElementById('session-info');
    if (sessionInfo) {
      const timeStr = new Date(data.session.createdAt).toLocaleTimeString();
      const displayName = data.session.name || `Session (${timeStr})`;
      sessionInfo.textContent = displayName;
    }

    // Update localStorage
    localStorage.setItem('sessionId', data.session.id);

    // Set session context on terminal manager (clears terminals from old session)
    this.terminalManager.setSession(data.session.id);

    // If terminal panel was open, create a new terminal for the new session
    if (this.elements.terminalPanel.classList.contains('show')) {
      this.ensureTerminalForCurrentSession();
    }

    // Refresh session lists
    this.ws.listSessions();

    // Close the session menu if open
    this.elements.sessionMenu.classList.remove('show');
  }

  deleteSession(sessionId, sessionName) {
    // Confirm deletion
    const confirmMessage = `Are you sure you want to delete "${sessionName || 'this session'}"?\n\nThis action cannot be undone.`;
    if (!confirm(confirmMessage)) {
      return;
    }

    // Send delete request
    this.ws.deleteSession(sessionId);
  }

  resetCurrentSession() {
    if (!this.currentSessionId) {
      return;
    }

    const confirmMessage =
      'Are you sure you want to reset this session?\n\nThis will delete all messages and create a new session in the same directory.';
    if (!confirm(confirmMessage)) {
      return;
    }

    // Send reset request
    this.ws.resetSession(this.currentSessionId);
  }

  renameCurrentSession() {
    if (!this.currentSessionId) {
      return;
    }
    const currentName = this.currentSessionName || '';
    const newName = prompt('Enter new session name:', currentName);
    if (newName !== null && newName.trim() !== '' && newName.trim() !== currentName) {
      this.ws.renameSession(newName.trim());
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
