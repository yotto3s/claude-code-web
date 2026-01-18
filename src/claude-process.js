const { spawn } = require('child_process');
const EventEmitter = require('events');
const path = require('path');

class ClaudeProcess extends EventEmitter {
  constructor(workingDirectory) {
    super();
    this.workingDirectory = workingDirectory || process.cwd();
    this.process = null;
    this.buffer = '';
    this.isProcessing = false;
    this.currentMessageId = null;
    this.sessionId = null;
  }

  start() {
    if (this.process) {
      return;
    }

    // Build environment for Claude process
    const env = {
      ...process.env,
      // Ensure Claude doesn't try to use interactive features
      TERM: 'dumb',
      CI: 'true',
      // Always ensure Claude knows where to find config
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ||
                         path.join(process.env.HOME || '/home/node', '.claude')
    };

    // Build spawn options
    const spawnOptions = {
      cwd: this.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    };

    // Build args for claude CLI with streaming JSON I/O
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--add-dir', this.workingDirectory
    ];

    // Resume previous session if we have a sessionId
    if (this.sessionId) {
      args.push('--resume', this.sessionId);
    }

    this.process = spawn('claude', args, spawnOptions);

    this.process.stdout.on('data', (data) => {
      this.handleOutput(data.toString());
    });

    this.process.stderr.on('data', (data) => {
      const text = data.toString();
      // Claude sometimes writes status messages to stderr
      this.emit('stderr', text);
    });

    this.process.on('error', (err) => {
      this.emit('error', { message: err.message });
    });

    this.process.on('close', (code) => {
      this.process = null;
      this.emit('close', code);
    });

    this.emit('started');
  }

  handleOutput(data) {
    // Add data to buffer
    this.buffer += data;

    // Process complete JSON lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        this.handleMessage(parsed);
      } catch (err) {
        // Not valid JSON, might be plain text output
        this.emit('text', line);
      }
    }
  }

  handleMessage(msg) {
    // Handle different message types from Claude's stream-json output
    switch (msg.type) {
      case 'system':
        // Capture session ID from init message
        if (msg.subtype === 'init' && msg.session_id) {
          this.sessionId = msg.session_id;
          this.emit('ready');
        }
        this.emit('system', msg);
        break;

      case 'assistant':
        // Full assistant response (in -p mode)
        this.currentMessageId = msg.message?.id;
        this.emit('message_start', msg.message);

        // Extract and emit text content
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text') {
              this.emit('chunk', { index: 0, text: block.text });
            }
          }
        }
        break;

      case 'content_block_start':
        this.emit('content_start', {
          index: msg.index,
          contentBlock: msg.content_block
        });
        break;

      case 'content_block_delta':
        // Streaming content
        if (msg.delta?.type === 'text_delta') {
          this.emit('chunk', {
            index: msg.index,
            text: msg.delta.text
          });
        } else if (msg.delta?.type === 'input_json_delta') {
          this.emit('tool_input_delta', {
            index: msg.index,
            json: msg.delta.partial_json
          });
        }
        break;

      case 'content_block_stop':
        this.emit('content_stop', { index: msg.index });
        break;

      case 'message_start':
        this.emit('message_start', msg.message);
        break;

      case 'message_delta':
        if (msg.delta?.stop_reason) {
          this.emit('message_delta', {
            stopReason: msg.delta.stop_reason,
            usage: msg.usage
          });
        }
        break;

      case 'message_stop':
        this.isProcessing = false;
        this.emit('complete', { messageId: this.currentMessageId });
        break;

      case 'result':
        // Final result from Claude
        this.isProcessing = false;
        this.emit('complete', { messageId: this.currentMessageId });
        this.emit('result', msg);
        break;

      case 'error':
        this.emit('error', {
          message: msg.error?.message || 'Unknown error',
          code: msg.error?.code
        });
        break;

      default:
        // Pass through unknown message types
        this.emit('message', msg);
    }
  }

  sendMessage(content) {
    if (!this.process || !this.process.stdin.writable) {
      this.emit('error', { message: 'Process not running' });
      return false;
    }

    this.isProcessing = true;

    // Format message for stream-json input
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: content
      }
    });

    this.process.stdin.write(msg + '\n');
    return true;
  }

  cancel() {
    if (this.process && this.isProcessing) {
      // Send SIGINT to cancel current operation
      this.process.kill('SIGINT');
      this.isProcessing = false;
      this.emit('cancelled');
    }
  }

  terminate() {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  isRunning() {
    return this.process !== null;
  }
}

module.exports = { ClaudeProcess };
