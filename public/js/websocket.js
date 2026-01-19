// WebSocket Client

class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.handlers = {};
    this.sessionId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          this.emit('connected');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (err) {
            console.error('Failed to parse message:', err);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.emit('disconnected', { code: event.code, reason: event.reason });

          // If unauthorized, redirect to login
          if (event.code === 4001) {
            window.location.href = '/login';
            return;
          }

          // Attempt reconnection
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
              this.reconnectAttempts++;
              console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
              this.connect().catch(() => {});
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        this.emit('auth', msg.auth);
        break;

      case 'session_created':
        this.sessionId = msg.session.id;
        this.emit('session_created', msg.session);
        break;

      case 'session_joined':
        this.sessionId = msg.session.id;
        this.emit('session_joined', { session: msg.session, history: msg.history });
        break;

      case 'sessions_list':
        this.emit('sessions_list', msg.sessions);
        break;

      case 'session_renamed':
        this.emit('session_renamed', { sessionId: msg.sessionId, name: msg.name });
        break;

      case 'message_sent':
        this.emit('message_sent');
        break;

      case 'message_start':
        this.emit('message_start', msg.message);
        break;

      case 'content_start':
        this.emit('content_start', msg);
        break;

      case 'chunk':
        this.emit('chunk', { text: msg.text, index: msg.index });
        break;

      case 'content_stop':
        this.emit('content_stop', { index: msg.index });
        break;

      case 'tool_input_delta':
        this.emit('tool_input_delta', msg);
        break;

      case 'message_delta':
        this.emit('message_delta', msg);
        break;

      case 'complete':
        this.emit('complete', msg);
        break;

      case 'result':
        this.emit('result', msg.data);
        break;

      case 'cancelled':
        this.emit('cancelled');
        break;

      case 'error':
        this.emit('error', { message: msg.message, code: msg.code });
        break;

      case 'text':
        this.emit('text', msg.content);
        break;

      case 'system':
        this.emit('system', msg.data);
        break;

      case 'process_closed':
        this.emit('process_closed', { code: msg.code });
        break;

      case 'terminal_created':
        this.emit('terminal_created', { terminalId: msg.terminalId, cwd: msg.cwd });
        break;

      case 'terminal_data':
        this.emit('terminal_data', { terminalId: msg.terminalId, data: msg.data });
        break;

      case 'terminal_exit':
        this.emit('terminal_exit', { terminalId: msg.terminalId, exitCode: msg.exitCode, signal: msg.signal });
        break;

      case 'terminal_closed':
        this.emit('terminal_closed', { terminalId: msg.terminalId, success: msg.success });
        break;

      case 'prompt':
        this.emit('prompt', {
          requestId: msg.requestId,
          toolUseId: msg.toolUseId,
          toolName: msg.toolName,
          input: msg.input
        });
        break;

      case 'permission_request':
        this.emit('permission_request', {
          requestId: msg.requestId,
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          toolUseId: msg.toolUseId
        });
        break;

      case 'mode_changed':
        this.emit('mode_changed', { mode: msg.mode });
        break;

      case 'agent_start':
        this.emit('agent_start', {
          taskId: msg.taskId,
          description: msg.description,
          agentType: msg.agentType,
          startTime: msg.startTime
        });
        break;

      case 'task_notification':
        this.emit('task_notification', {
          taskId: msg.taskId,
          status: msg.status,
          summary: msg.summary,
          outputFile: msg.outputFile,
          description: msg.description,
          agentType: msg.agentType
        });
        break;

      case 'agents_list':
        this.emit('agents_list', msg.agents);
        break;

      default:
        console.log('Unknown message type:', msg.type, msg);
    }
  }

  send(typeOrMsg, data = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return false;
    }

    // Support both send(type, data) and send(messageObject)
    let message;
    if (typeof typeOrMsg === 'string') {
      message = { type: typeOrMsg, ...data };
    } else {
      message = typeOrMsg;
    }

    this.ws.send(JSON.stringify(message));
    return true;
  }

  createSession(workingDirectory, name) {
    return this.send('create_session', { workingDirectory, name });
  }

  renameSession(name) {
    return this.send('rename_session', { name });
  }

  joinSession(sessionId) {
    return this.send('join_session', { sessionId });
  }

  listSessions() {
    return this.send('list_sessions');
  }

  sendMessage(content) {
    return this.send('message', { content });
  }

  cancel() {
    return this.send('cancel');
  }

  sendPromptResponse(requestId, response) {
    return this.send('prompt_response', { requestId, response });
  }

  sendPermissionResponse(requestId, decision, toolInput) {
    return this.send('permission_response', { requestId, decision, toolInput });
  }

  listAgents() {
    return this.send('list_agents');
  }

  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
    return this;
  }

  emit(event, data) {
    const handlers = this.handlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error('Handler error:', err);
        }
      }
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Make available globally
window.WebSocketClient = WebSocketClient;
