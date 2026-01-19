// Chat UI Components

class ChatUI {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.currentAssistantMessage = null;
    this.currentToolIndicator = null;
    this.currentPrompt = null;
    this.isPermissionPrompt = false; // Track if current prompt requires user action (should not be auto-removed)
  }

  clearMessages() {
    this.container.innerHTML = '';
    this.messages = [];
    this.currentAssistantMessage = null;
    this.showWelcome();
  }

  showWelcome() {
    const welcome = document.createElement('div');
    welcome.className = 'welcome-message';
    welcome.id = 'welcome';
    welcome.innerHTML = `
      <h2>Welcome to Claude Code</h2>
      <p>Start a conversation to begin</p>
    `;
    this.container.appendChild(welcome);
  }

  hideWelcome() {
    const welcome = document.getElementById('welcome');
    if (welcome) {
      welcome.remove();
    }
  }

  addUserMessage(content) {
    this.hideWelcome();

    const msg = this.createMessageElement('user', content);
    this.container.appendChild(msg);
    this.messages.push({ role: 'user', content, element: msg });
    this.scrollToBottom();

    return msg;
  }

  startAssistantMessage() {
    this.hideWelcome();

    const msg = this.createMessageElement('assistant', '');
    this.container.appendChild(msg);
    this.currentAssistantMessage = {
      element: msg,
      content: '',
      bubble: msg.querySelector('.message-bubble'),
      contentDiv: msg.querySelector('.message-content')
    };

    this.scrollToBottom();
    return msg;
  }

  appendToAssistantMessage(text) {
    if (!this.currentAssistantMessage) {
      this.startAssistantMessage();
    }

    this.currentAssistantMessage.content += text;

    // Render markdown
    this.currentAssistantMessage.contentDiv.innerHTML =
      renderMarkdown(this.currentAssistantMessage.content);

    this.scrollToBottom();
  }

  finishAssistantMessage() {
    if (this.currentAssistantMessage) {
      // Check if message has any content
      if (this.currentAssistantMessage.content) {
        // Final render
        this.currentAssistantMessage.contentDiv.innerHTML =
          renderMarkdown(this.currentAssistantMessage.content);

        this.messages.push({
          role: 'assistant',
          content: this.currentAssistantMessage.content,
          element: this.currentAssistantMessage.element
        });
      } else {
        // Remove empty message element from DOM
        this.currentAssistantMessage.element.remove();
      }

      this.currentAssistantMessage = null;
    }

    this.removeToolIndicator();
    this.scrollToBottom();
  }

  showToolUse(toolName, isRunning = true) {
    this.removeToolIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'tool-indicator';
    indicator.innerHTML = `
      ${isRunning ? '<div class="spinner"></div>' : ''}
      <span>Using tool: ${escapeHtml(toolName)}</span>
    `;

    // Insert before or after current assistant message
    if (this.currentAssistantMessage) {
      this.currentAssistantMessage.element.appendChild(indicator);
    } else {
      this.container.appendChild(indicator);
    }

    this.currentToolIndicator = indicator;
    this.scrollToBottom();
  }

  showToolExecution(toolName, toolInput) {
    // Create a collapsible tool execution block
    const toolBlock = document.createElement('div');
    toolBlock.className = 'tool-execution';

    // Format the input for display
    let inputDisplay = '';
    if (toolInput) {
      if (toolInput.command) {
        // Bash command
        inputDisplay = `<code class="tool-command">${escapeHtml(toolInput.command)}</code>`;
        if (toolInput.description) {
          inputDisplay = `<span class="tool-description">${escapeHtml(toolInput.description)}</span>` + inputDisplay;
        }
      } else if (toolInput.file_path) {
        // File operations (Read, Write, Edit)
        inputDisplay = `<code class="tool-filepath">${escapeHtml(toolInput.file_path)}</code>`;
        if (toolInput.pattern) {
          inputDisplay += `<span class="tool-pattern">Pattern: ${escapeHtml(toolInput.pattern)}</span>`;
        }
        if (toolInput.old_string && toolInput.new_string) {
          inputDisplay += `<div class="tool-edit-preview">
            <div class="edit-old"><span class="edit-label">-</span>${escapeHtml(toolInput.old_string.substring(0, 100))}${toolInput.old_string.length > 100 ? '...' : ''}</div>
            <div class="edit-new"><span class="edit-label">+</span>${escapeHtml(toolInput.new_string.substring(0, 100))}${toolInput.new_string.length > 100 ? '...' : ''}</div>
          </div>`;
        }
      } else if (toolInput.pattern) {
        // Glob or Grep
        inputDisplay = `<code class="tool-pattern">${escapeHtml(toolInput.pattern)}</code>`;
        if (toolInput.path) {
          inputDisplay += ` <span class="tool-path">in ${escapeHtml(toolInput.path)}</span>`;
        }
      } else if (toolInput.query) {
        // WebSearch
        inputDisplay = `<code class="tool-query">${escapeHtml(toolInput.query)}</code>`;
      } else if (toolInput.url) {
        // WebFetch
        inputDisplay = `<code class="tool-url">${escapeHtml(toolInput.url)}</code>`;
      } else if (toolInput.prompt) {
        // Task agent
        inputDisplay = `<span class="tool-prompt">${escapeHtml(toolInput.prompt.substring(0, 150))}${toolInput.prompt.length > 150 ? '...' : ''}</span>`;
      } else {
        // Generic display for other tools
        const inputStr = JSON.stringify(toolInput, null, 2);
        if (inputStr.length > 200) {
          inputDisplay = `<pre class="tool-json">${escapeHtml(inputStr.substring(0, 200))}...</pre>`;
        } else {
          inputDisplay = `<pre class="tool-json">${escapeHtml(inputStr)}</pre>`;
        }
      }
    }

    toolBlock.innerHTML = `
      <div class="tool-execution-header">
        <span class="tool-execution-icon">⚡</span>
        <span class="tool-execution-name">${escapeHtml(toolName)}</span>
        <span class="tool-execution-time">${new Date().toLocaleTimeString()}</span>
      </div>
      ${inputDisplay ? `<div class="tool-execution-input">${inputDisplay}</div>` : ''}
    `;

    // Insert the tool execution block
    if (this.currentAssistantMessage) {
      this.currentAssistantMessage.element.appendChild(toolBlock);
    } else {
      this.container.appendChild(toolBlock);
    }

    this.scrollToBottom();
    return toolBlock;
  }

  removeToolIndicator() {
    if (this.currentToolIndicator) {
      this.currentToolIndicator.remove();
      this.currentToolIndicator = null;
    }
  }

  createMessageElement(role, content) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    if (role === 'user') {
      contentDiv.textContent = content;
    } else {
      contentDiv.innerHTML = content ? renderMarkdown(content) : '';
    }

    bubble.appendChild(contentDiv);
    msg.appendChild(bubble);

    // Add timestamp
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = new Date().toLocaleTimeString();
    msg.appendChild(meta);

    return msg;
  }

  showError(message) {
    const error = document.createElement('div');
    error.className = 'message assistant';
    error.innerHTML = `
      <div class="message-bubble" style="border-color: var(--error-color);">
        <div class="message-content" style="color: var(--error-color);">
          Error: ${escapeHtml(message)}
        </div>
      </div>
    `;
    this.container.appendChild(error);
    this.scrollToBottom();
  }

  showSystemMessage(message) {
    const sys = document.createElement('div');
    sys.className = 'message assistant';
    sys.innerHTML = `
      <div class="message-bubble" style="border-color: var(--warning-color); background: rgba(251, 191, 36, 0.1);">
        <div class="message-content" style="color: var(--warning-color);">
          ${escapeHtml(message)}
        </div>
      </div>
    `;
    this.container.appendChild(sys);
    this.scrollToBottom();
  }

  loadHistory(history) {
    this.clearMessages();
    this.hideWelcome();

    for (const entry of history) {
      if (entry.role === 'user') {
        const msg = this.createMessageElement('user', entry.content);
        this.container.appendChild(msg);
        this.messages.push({ role: 'user', content: entry.content, element: msg });
      } else if (entry.role === 'assistant') {
        const content = typeof entry.content === 'string'
          ? entry.content
          : JSON.stringify(entry.content);
        const msg = this.createMessageElement('assistant', content);
        this.container.appendChild(msg);
        this.messages.push({ role: 'assistant', content, element: msg });
      }
    }

    this.scrollToBottom();
  }

  showPrompt(data, onResponse) {
    this.removePrompt();

    const promptContainer = document.createElement('div');
    promptContainer.className = 'prompt-container';

    const requestId = data.requestId;
    const questions = data.input?.questions || [];
    const responses = {};

    questions.forEach((q, idx) => {
      const questionDiv = document.createElement('div');
      questionDiv.className = 'prompt-question';

      // Header chip
      if (q.header) {
        const header = document.createElement('span');
        header.className = 'prompt-header';
        header.textContent = q.header;
        questionDiv.appendChild(header);
      }

      // Question text
      const questionText = document.createElement('div');
      questionText.className = 'prompt-text';
      questionText.textContent = q.question;
      questionDiv.appendChild(questionText);

      // Options container
      const optionsDiv = document.createElement('div');
      optionsDiv.className = 'prompt-options';

      const isMultiSelect = q.multiSelect === true;
      const selectedOptions = new Set();

      q.options.forEach((opt) => {
        const optionBtn = document.createElement('button');
        optionBtn.className = 'prompt-option';
        optionBtn.innerHTML = `
          <span class="prompt-option-label">${escapeHtml(opt.label)}</span>
          ${opt.description ? `<span class="prompt-option-desc">${escapeHtml(opt.description)}</span>` : ''}
        `;

        optionBtn.addEventListener('click', () => {
          if (isMultiSelect) {
            // Toggle selection
            if (selectedOptions.has(opt.label)) {
              selectedOptions.delete(opt.label);
              optionBtn.classList.remove('selected');
            } else {
              selectedOptions.add(opt.label);
              optionBtn.classList.add('selected');
            }
            responses[idx] = Array.from(selectedOptions);
          } else {
            // Single select - submit immediately
            responses[idx] = opt.label;
            this.removePrompt();
            onResponse(requestId, { answers: responses });
          }
        });

        optionsDiv.appendChild(optionBtn);
      });

      questionDiv.appendChild(optionsDiv);

      // Custom input ("Other" option)
      const customDiv = document.createElement('div');
      customDiv.className = 'prompt-custom';
      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.placeholder = 'Or type a custom response...';
      const customSubmit = document.createElement('button');
      customSubmit.className = 'btn btn-secondary prompt-custom-btn';
      customSubmit.textContent = 'Submit';

      customSubmit.addEventListener('click', () => {
        const value = customInput.value.trim();
        if (value) {
          responses[idx] = value;
          this.removePrompt();
          onResponse(requestId, { answers: responses });
        }
      });

      customInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          customSubmit.click();
        }
      });

      customDiv.appendChild(customInput);
      customDiv.appendChild(customSubmit);
      questionDiv.appendChild(customDiv);

      promptContainer.appendChild(questionDiv);

      // Submit button for multiSelect
      if (isMultiSelect) {
        const submitBtn = document.createElement('button');
        submitBtn.className = 'btn btn-primary prompt-submit-btn';
        submitBtn.textContent = 'Submit Selection';
        submitBtn.addEventListener('click', () => {
          if (selectedOptions.size > 0) {
            responses[idx] = Array.from(selectedOptions);
          }
          this.removePrompt();
          onResponse(requestId, { answers: responses });
        });
        promptContainer.appendChild(submitBtn);
      }
    });

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary prompt-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this.removePrompt();
      // Send empty response to indicate cancellation
      onResponse(requestId, { answers: {}, cancelled: true });
    });
    promptContainer.appendChild(cancelBtn);

    this.container.appendChild(promptContainer);
    this.currentPrompt = promptContainer;
    this.scrollToBottom();
  }

  removePrompt(force = false) {
    // Don't auto-remove permission prompts unless forced
    if (this.currentPrompt && (force || !this.isPermissionPrompt)) {
      this.currentPrompt.remove();
      this.currentPrompt = null;
      this.isPermissionPrompt = false;
    }
  }

  // Force remove any prompt (used when user responds to permission prompt)
  forceRemovePrompt() {
    if (this.currentPrompt) {
      this.currentPrompt.remove();
      this.currentPrompt = null;
      this.isPermissionPrompt = false;
    }
  }

  showPermissionPrompt(data, onResponse) {
    this.forceRemovePrompt();

    const promptContainer = document.createElement('div');
    promptContainer.className = 'prompt-container permission-prompt';

    const requestId = data.requestId;
    const toolName = data.toolName || 'Unknown Tool';
    const toolInput = data.toolInput || {};

    // Header
    const header = document.createElement('div');
    header.className = 'permission-header';
    header.innerHTML = `
      <span class="permission-icon">🔐</span>
      <span class="permission-title">Permission Required</span>
    `;
    promptContainer.appendChild(header);

    // Tool info
    const toolInfo = document.createElement('div');
    toolInfo.className = 'permission-tool-info';
    toolInfo.innerHTML = `
      <div class="permission-tool-name">Tool: <strong>${escapeHtml(toolName)}</strong></div>
    `;

    // Show tool input details
    if (Object.keys(toolInput).length > 0) {
      const inputDetails = document.createElement('div');
      inputDetails.className = 'permission-tool-input';

      // Format the input nicely
      if (toolInput.command) {
        inputDetails.innerHTML = `<code>${escapeHtml(toolInput.command)}</code>`;
      } else if (toolInput.file_path) {
        inputDetails.innerHTML = `<code>${escapeHtml(toolInput.file_path)}</code>`;
      } else {
        inputDetails.innerHTML = `<pre>${escapeHtml(JSON.stringify(toolInput, null, 2))}</pre>`;
      }
      toolInfo.appendChild(inputDetails);
    }
    promptContainer.appendChild(toolInfo);

    // Buttons container
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'permission-buttons';

    // Allow button
    const allowBtn = document.createElement('button');
    allowBtn.className = 'btn btn-primary permission-btn';
    allowBtn.textContent = 'Allow';
    allowBtn.addEventListener('click', () => {
      this.forceRemovePrompt();
      onResponse(requestId, 'allow', toolInput);
    });

    // Allow All button
    const allowAllBtn = document.createElement('button');
    allowAllBtn.className = 'btn btn-secondary permission-btn';
    allowAllBtn.textContent = 'Allow All';
    allowAllBtn.title = 'Allow this tool for the rest of the session';
    allowAllBtn.addEventListener('click', () => {
      this.forceRemovePrompt();
      onResponse(requestId, 'allow_all', toolInput);
    });

    // Deny button
    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn btn-danger permission-btn';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      this.forceRemovePrompt();
      onResponse(requestId, 'deny', toolInput);
    });

    buttonsDiv.appendChild(allowBtn);
    buttonsDiv.appendChild(allowAllBtn);
    buttonsDiv.appendChild(denyBtn);
    promptContainer.appendChild(buttonsDiv);

    this.container.appendChild(promptContainer);
    this.currentPrompt = promptContainer;
    this.isPermissionPrompt = true; // Mark as permission prompt - should not be auto-removed
    this.scrollToBottom();
  }

  showExitPlanModePrompt(data, onResponse) {
    this.forceRemovePrompt();

    const promptContainer = document.createElement('div');
    promptContainer.className = 'prompt-container permission-prompt exit-plan-mode-prompt';

    const requestId = data.requestId;

    // Header
    const header = document.createElement('div');
    header.className = 'permission-header';
    header.innerHTML = `
      <span class="permission-icon">📋</span>
      <span class="permission-title">Exit Plan Mode?</span>
    `;
    promptContainer.appendChild(header);

    // Description
    const description = document.createElement('div');
    description.className = 'permission-tool-info';
    description.innerHTML = `
      <div class="exit-plan-mode-description">
        Claude wants to exit plan mode and proceed with implementation.
        <br><br>
        Approving will switch from <strong>Plan Mode</strong> to <strong>Default Mode</strong>,
        allowing Claude to execute commands and make changes.
      </div>
    `;
    promptContainer.appendChild(description);

    // Buttons container
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'permission-buttons';

    // Approve button
    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary permission-btn';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => {
      this.forceRemovePrompt();
      onResponse(requestId, true);
    });

    // Deny button
    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn btn-danger permission-btn';
    denyBtn.textContent = 'Stay in Plan Mode';
    denyBtn.addEventListener('click', () => {
      this.forceRemovePrompt();
      onResponse(requestId, false);
    });

    buttonsDiv.appendChild(approveBtn);
    buttonsDiv.appendChild(denyBtn);
    promptContainer.appendChild(buttonsDiv);

    this.container.appendChild(promptContainer);
    this.currentPrompt = promptContainer;
    this.isPermissionPrompt = true; // Mark as permission prompt - should not be auto-removed
    this.scrollToBottom();
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make available globally
window.ChatUI = ChatUI;
