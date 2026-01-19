const { query } = require('@anthropic-ai/claude-agent-sdk');
const EventEmitter = require('events');
const path = require('path');

class ClaudeProcess extends EventEmitter {
  constructor(workingDirectory) {
    super();
    this.workingDirectory = workingDirectory || process.cwd();
    this.queryInstance = null;
    this.messageQueue = [];
    this.messageResolver = null;
    this.sessionId = null;
    this.pendingPermissions = new Map(); // requestId -> {resolve, reject}
    this.isProcessing = false;
  }

  async start() {
    // Create async generator for streaming input
    const messageGenerator = this.createMessageGenerator();

    // Start the SDK query with canUseTool callback
    this.queryInstance = query({
      prompt: messageGenerator,
      options: {
        cwd: this.workingDirectory,
        permissionMode: 'default',
        canUseTool: async (toolName, input, options) => {
          return this.handlePermissionRequest(toolName, input, options);
        }
      }
    });

    // Process streaming responses
    this.processResponses();
    this.emit('started');
    this.emit('ready');
  }

  async *createMessageGenerator() {
    while (true) {
      // Wait for a message to be queued
      const message = await new Promise(resolve => {
        if (this.messageQueue.length > 0) {
          resolve(this.messageQueue.shift());
        } else {
          this.messageResolver = resolve;
        }
      });

      if (message === null) break; // Termination signal

      // SDKUserMessage format requires type, message, parent_tool_use_id, and session_id
      yield {
        type: 'user',
        message: {
          role: 'user',
          content: message
        },
        parent_tool_use_id: null,
        session_id: this.sessionId || 'pending'
      };
    }
  }

  async processResponses() {
    try {
      for await (const message of this.queryInstance) {
        this.handleSDKMessage(message);
      }
    } catch (err) {
      this.emit('error', { message: err.message });
    }
  }

  handleSDKMessage(msg) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id;
        }
        this.emit('system', msg);
        break;

      case 'assistant':
        this.emit('message_start', msg.message);
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              this.emit('chunk', { index: 0, text: block.text });
            } else if (block.type === 'tool_use') {
              // Handle AskUserQuestion tool
              if (block.name === 'AskUserQuestion') {
                this.emit('prompt', {
                  toolUseId: block.id,
                  toolName: block.name,
                  input: block.input
                });
              }
              this.emit('tool_use', {
                id: block.id,
                name: block.name,
                input: block.input
              });
            }
          }
        }
        break;

      case 'result':
        this.isProcessing = false;
        this.emit('complete', { messageId: msg.uuid });
        this.emit('result', msg);
        break;
    }
  }

  async handlePermissionRequest(toolName, input, options) {
    // Generate unique request ID
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Emit permission request to WebSocket clients
    this.emit('permission_request', {
      request_id: requestId,
      request: {
        tool_name: toolName,
        input: input,
        tool_use_id: options?.toolUseID
      }
    });

    // Wait for user response (with 60s timeout)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });
      }, 60000);

      this.pendingPermissions.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          this.pendingPermissions.delete(requestId);
          resolve(result);
        },
        reject
      });
    });
  }

  sendMessage(content) {
    this.isProcessing = true;

    if (this.messageResolver) {
      this.messageResolver(content);
      this.messageResolver = null;
    } else {
      this.messageQueue.push(content);
    }
    return true;
  }

  sendToolResponse(toolUseId, response) {
    // Note: With the SDK, tool responses are handled through the canUseTool callback
    // This method is kept for compatibility with AskUserQuestion responses
    // The SDK handles these internally when using streaming input mode
    console.log('sendToolResponse called:', toolUseId, response);
    return true;
  }

  sendControlResponse(requestId, decision, toolInput = null) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.log('sendControlResponse: No pending permission for requestId:', requestId);
      return false;
    }

    if (decision === 'allow' || decision === 'allow_all') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: toolInput || undefined
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: 'User denied permission'
      });
    }
    return true;
  }

  async cancel() {
    if (this.queryInstance && this.isProcessing) {
      await this.queryInstance.interrupt();
      this.isProcessing = false;
      this.emit('cancelled');
    }
  }

  terminate() {
    // Signal termination to message generator
    if (this.messageResolver) {
      this.messageResolver(null);
    } else {
      this.messageQueue.push(null);
    }
    this.queryInstance = null;
  }

  isRunning() {
    return this.queryInstance !== null;
  }
}

module.exports = { ClaudeProcess };
