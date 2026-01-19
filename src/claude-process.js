/**
 * Claude Process Module
 *
 * Wraps the Claude Agent SDK for AI interactions, providing:
 * - Streaming message input/output via async generators
 * - Mode-based permission handling (default, acceptEdits, plan)
 * - Agent tracking for background tasks
 * - Permission request/response flow
 * - AskUserQuestion handling
 * - Allowed tools tracking (for "Allow All" permission persistence)
 *
 * @module claude-process
 */

const { query } = require('@anthropic-ai/claude-agent-sdk');
const EventEmitter = require('events');

/**
 * ClaudeProcess wraps the Claude Agent SDK query() function.
 *
 * @extends EventEmitter
 *
 * @fires ClaudeProcess#started - When the process starts
 * @fires ClaudeProcess#ready - When the process is ready for messages
 * @fires ClaudeProcess#chunk - Streaming text content
 * @fires ClaudeProcess#complete - Message complete
 * @fires ClaudeProcess#result - Final result
 * @fires ClaudeProcess#error - Error occurred
 * @fires ClaudeProcess#cancelled - Operation cancelled
 * @fires ClaudeProcess#permission_request - Tool needs user approval
 * @fires ClaudeProcess#prompt - AskUserQuestion from Claude
 * @fires ClaudeProcess#tool_use - Tool being executed
 * @fires ClaudeProcess#agent_start - New agent task started
 * @fires ClaudeProcess#task_notification - Background task completed
 * @fires ClaudeProcess#exit_plan_mode_request - Plan mode exit requested
 * @fires ClaudeProcess#sdk_session_id - SDK session ID received (for persistence)
 */
class ClaudeProcess extends EventEmitter {
  /**
   * Create a new ClaudeProcess.
   *
   * @param {string} [workingDirectory] - Working directory for Claude operations
   * @param {string} [resumeSessionId] - SDK session ID to resume (for context restoration)
   */
  constructor(workingDirectory, resumeSessionId = null) {
    super();
    /** @type {string} Working directory for file operations */
    this.workingDirectory = workingDirectory || process.cwd();
    /** @type {string|null} SDK session ID to resume for context restoration */
    this.resumeSessionId = resumeSessionId;
    /** @type {object|null} SDK query instance */
    this.queryInstance = null;
    /** @type {string[]} Queue of pending messages */
    this.messageQueue = [];
    /** @type {function|null} Resolver for next message */
    this.messageResolver = null;
    /** @type {string|null} Current session ID */
    this.sessionId = null;
    /** @type {Map<string, {resolve: function, reject: function}>} Pending permission requests */
    this.pendingPermissions = new Map();
    /** @type {Map<string, {resolve: function}>} Pending prompt responses (AskUserQuestion) */
    this.pendingPrompts = new Map();
    /** @type {boolean} Whether a message is being processed */
    this.isProcessing = false;
    /** @type {'default'|'acceptEdits'|'plan'} Current operating mode */
    this.mode = 'default';
    /** @type {Map<string, {description: string, agentType: string, startTime: number}>} Active background agents */
    this.activeAgents = new Map();
    /** @type {string[]} Stack of active agent taskIds for tracking nested agents */
    this.agentContextStack = [];
    /** @type {Set<string>} Tools that have been approved via "Allow All" */
    this.allowedTools = new Set();
    /** @type {boolean} Whether web search is enabled */
    this.webSearchEnabled = false;
  }

  /**
   * Set the operating mode.
   *
   * @param {'default'|'acceptEdits'|'plan'} mode - The mode to set
   * - default: Normal operation with permission prompts
   * - acceptEdits: Auto-approve file edit operations
   * - plan: Read-only mode, only allows exploration tools
   */
  setMode(mode) {
    const validModes = ['default', 'acceptEdits', 'plan'];
    if (validModes.includes(mode)) {
      console.log(`[ClaudeProcess] Mode changed from '${this.mode}' to '${mode}'`);
      this.mode = mode;
    }
  }

  /**
   * Set the allowed tools from a Set (used when recovering sessions).
   *
   * @param {Set<string>} toolsSet - Set of tool names to allow
   */
  setAllowedTools(toolsSet) {
    this.allowedTools = new Set(toolsSet);
    console.log(`[ClaudeProcess] Allowed tools initialized:`, Array.from(this.allowedTools));
  }

  /**
   * Add a tool to the allowed list (called when user clicks "Allow All").
   *
   * @param {string} toolName - Name of the tool to allow
   */
  addAllowedTool(toolName) {
    this.allowedTools.add(toolName);
    console.log(`[ClaudeProcess] Tool "${toolName}" added to allowed list`);
  }

  /**
   * Check if a tool has been approved via "Allow All".
   *
   * @param {string} toolName - Name of the tool to check
   * @returns {boolean} Whether the tool is allowed
   */
  isToolAllowed(toolName) {
    return this.allowedTools.has(toolName);
  }

  /**
   * Clear all allowed tools (reset permissions).
   */
  clearAllowedTools() {
    this.allowedTools.clear();
    console.log(`[ClaudeProcess] All allowed tools cleared`);
  }

  /**
   * Enable or disable web search capability.
   * When enabled, Claude will be encouraged to use web search for current information.
   *
   * @param {boolean} enabled - Whether web search is enabled
   */
  setWebSearchEnabled(enabled) {
    this.webSearchEnabled = Boolean(enabled);
    console.log(`[ClaudeProcess] Web search ${this.webSearchEnabled ? 'enabled' : 'disabled'}`);
  }

  async start() {
    // Create async generator for streaming input
    const messageGenerator = this.createMessageGenerator();

    // Build options for SDK query
    const queryOptions = {
      cwd: this.workingDirectory,
      permissionMode: 'default',
      canUseTool: async (toolName, input, options) => {
        console.log(`[canUseTool] Tool: ${toolName}, Mode: ${this.mode}`);

        // Handle AskUserQuestion specially - return user answers via updatedInput
        if (toolName === 'AskUserQuestion') {
          return this.handleAskUserQuestion(toolName, input, options);
        }

        // Plan mode: only allow read-only tools, deny all write/execute operations
        if (this.mode === 'plan') {
          // ExitPlanMode requires user approval to switch modes
          if (toolName === 'ExitPlanMode') {
            console.log(`[canUseTool] Plan mode: ExitPlanMode called, requesting user approval`);
            return this.handleExitPlanModeRequest(toolName, input, options);
          }

          const readOnlyTools = [
            'Read',
            'Glob',
            'Grep',
            'WebFetch',
            'WebSearch',
            'Task',
            'TodoWrite',
            'EnterPlanMode',
          ];
          if (readOnlyTools.includes(toolName)) {
            console.log(`[canUseTool] Plan mode: allowing read-only tool: ${toolName}`);
            return { behavior: 'allow', updatedInput: input };
          }
          console.log(`[canUseTool] Plan mode: denying write/execute tool: ${toolName}`);
          return {
            behavior: 'deny',
            message:
              'Plan mode: only read-only operations are allowed. Switch to default mode to execute this tool.',
          };
        }

        // Accept Edits mode: auto-approve file operations
        if (this.mode === 'acceptEdits') {
          const editTools = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
          if (editTools.includes(toolName)) {
            console.log(`[canUseTool] Auto-approving edit tool: ${toolName}`);
            return { behavior: 'allow', updatedInput: input };
          }
        }

        // Check if tool was previously approved via "Allow All"
        if (this.isToolAllowed(toolName)) {
          console.log(`[canUseTool] Tool "${toolName}" pre-approved via Allow All`);
          return { behavior: 'allow', updatedInput: input };
        }

        // Default mode: go through permission flow
        console.log(`[canUseTool] Requesting permission for: ${toolName}`);
        return this.handlePermissionRequest(toolName, input, options);
      },
    };

    // Add resume option if we have an SDK session ID to resume
    if (this.resumeSessionId) {
      queryOptions.resume = this.resumeSessionId;
      console.log(`[ClaudeProcess] Resuming SDK session: ${this.resumeSessionId}`);
    }

    // Start the SDK query
    this.queryInstance = query({
      prompt: messageGenerator,
      options: queryOptions,
    });

    // Process streaming responses
    this.processResponses();
    this.emit('started');
    this.emit('ready');
  }

  async *createMessageGenerator() {
    while (true) {
      // Wait for a message to be queued
      const message = await new Promise((resolve) => {
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
          content: message,
        },
        parent_tool_use_id: null,
        session_id: this.sessionId || 'pending',
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
          // Emit sdk_session_id event so it can be persisted for future resume
          this.emit('sdk_session_id', msg.session_id);
          console.log(`[ClaudeProcess] SDK session initialized: ${msg.session_id}`);
        } else if (msg.subtype === 'task_notification') {
          // Handle background task completion notification
          const taskId = msg.task_id;
          const agentInfo = this.activeAgents.get(taskId);

          this.emit('task_notification', {
            taskId: taskId,
            status: msg.status, // 'completed' | 'failed' | 'stopped'
            outputFile: msg.output_file,
            summary: msg.summary,
            description: agentInfo?.description || 'Unknown task',
            agentType: agentInfo?.agentType || 'unknown',
          });

          // Remove from active agents
          this.activeAgents.delete(taskId);

          // Pop from agent context stack
          const stackIndex = this.agentContextStack.indexOf(taskId);
          if (stackIndex !== -1) {
            this.agentContextStack.splice(stackIndex, 1);
          }
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
              // Track Task tool invocations as agent starts
              if (block.name === 'Task') {
                const taskId = block.id;
                const description = block.input?.description || 'Agent task';
                const agentType = block.input?.subagent_type || 'unknown';

                this.activeAgents.set(taskId, {
                  description,
                  agentType,
                  startTime: Date.now(),
                });

                // Push this agent onto the context stack
                this.agentContextStack.push(taskId);

                this.emit('agent_start', {
                  taskId,
                  description,
                  agentType,
                  startTime: Date.now(),
                });
              }

              // Get current agent context (if any) for non-Task tools
              // Task tools themselves are shown in main chat, but their child tools go to the panel
              const currentAgentId =
                block.name !== 'Task' && this.agentContextStack.length > 0
                  ? this.agentContextStack[this.agentContextStack.length - 1]
                  : null;

              // AskUserQuestion is handled in canUseTool callback, not here
              this.emit('tool_use', {
                id: block.id,
                name: block.name,
                input: block.input,
                agentId: currentAgentId,
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
        tool_use_id: options?.toolUseID,
      },
    });

    // Wait for user response (no timeout)
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(requestId, {
        toolName, // Store toolName for "Allow All" persistence
        resolve: (result) => {
          this.pendingPermissions.delete(requestId);
          resolve(result);
        },
        reject,
      });
    });
  }

  async handleAskUserQuestion(toolName, input, options) {
    // Generate unique request ID for the prompt
    const requestId = `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Emit prompt event to frontend with the questions
    this.emit('prompt', {
      request_id: requestId,
      toolUseId: options?.toolUseID,
      toolName: toolName,
      input: input,
    });

    // Wait for user response (no timeout)
    return new Promise((resolve) => {
      this.pendingPrompts.set(requestId, {
        resolve: (answers) => {
          this.pendingPrompts.delete(requestId);
          // Return allow with the answers populated in input
          resolve({
            behavior: 'allow',
            updatedInput: { ...input, answers },
          });
        },
      });
    });
  }

  sendPromptResponse(requestId, answers) {
    const pending = this.pendingPrompts.get(requestId);
    if (!pending) {
      console.log('sendPromptResponse: No pending prompt for requestId:', requestId);
      return false;
    }

    pending.resolve(answers);
    return true;
  }

  async handleExitPlanModeRequest(toolName, input, options) {
    // Generate unique request ID for the exit plan mode request
    const requestId = `exit_plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Emit event to frontend requesting approval to exit plan mode
    this.emit('exit_plan_mode_request', {
      request_id: requestId,
      toolUseId: options?.toolUseID,
      input: input,
    });

    // Wait for user response (no timeout)
    return new Promise((resolve) => {
      this.pendingPrompts.set(requestId, {
        resolve: (approved) => {
          this.pendingPrompts.delete(requestId);
          if (approved) {
            // User approved - allow the tool and switch mode
            resolve({ behavior: 'allow', updatedInput: input });
          } else {
            // User denied - deny the tool
            resolve({ behavior: 'deny', message: 'User denied exiting plan mode' });
          }
        },
      });
    });
  }

  sendExitPlanModeResponse(requestId, approved) {
    const pending = this.pendingPrompts.get(requestId);
    if (!pending) {
      console.log('sendExitPlanModeResponse: No pending request for requestId:', requestId);
      return false;
    }

    pending.resolve(approved);
    return true;
  }

  sendMessage(content) {
    this.isProcessing = true;

    // Prepend mode context for plan mode so the agent knows its current mode
    let messageContent = content;
    if (this.mode === 'plan') {
      messageContent = `[SYSTEM: You are currently in PLAN MODE. In this mode, you should focus on planning and analysis only. You can read files, search code, and explore the codebase, but you should NOT make any changes to files or execute commands that modify the system. Create a detailed plan for the user's request and use the ExitPlanMode tool when ready for approval.

IMPORTANT: Before calling ExitPlanMode, you MUST share your complete plan with the user in the chat message. Present the plan clearly, then ask if they approve before using the ExitPlanMode tool.

If web search is enabled, actively use it during planning to research best practices, current documentation, latest APIs, and any relevant information that could improve your plan.]\n\n${content}`;
    }

    // Add web search encouragement if enabled
    if (this.webSearchEnabled) {
      messageContent = `[SYSTEM: Web search is ENABLED. You are encouraged to use the WebSearch tool to find current, up-to-date information when it would be helpful for the task. Use web search proactively for: recent news, current documentation, latest versions, real-time data, or any information that may have changed since your training.]\n\n${messageContent}`;
    }

    if (this.messageResolver) {
      this.messageResolver(messageContent);
      this.messageResolver = null;
    } else {
      this.messageQueue.push(messageContent);
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
      return { success: false, toolName: null };
    }

    if (decision === 'allow' || decision === 'allow_all') {
      // If "Allow All", add tool to allowed list and emit event for persistence
      if (decision === 'allow_all' && pending.toolName) {
        this.addAllowedTool(pending.toolName);
        this.emit('tool_allowed', pending.toolName);
      }

      pending.resolve({
        behavior: 'allow',
        updatedInput: toolInput || undefined,
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: 'User denied permission',
      });
    }
    return { success: true, toolName: pending.toolName };
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

  getActiveAgents() {
    const agents = [];
    for (const [taskId, info] of this.activeAgents) {
      agents.push({
        taskId,
        description: info.description,
        agentType: info.agentType,
        startTime: info.startTime,
        status: 'running',
      });
    }
    return agents;
  }
}

module.exports = { ClaudeProcess };
