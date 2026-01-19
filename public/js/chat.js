// Chat UI Components

class ChatUI {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.currentAssistantMessage = null;
    this.currentToolIndicator = null;
    this.currentPrompt = null;
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

    // Add typing indicator
    this.currentAssistantMessage.contentDiv.innerHTML = `
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;

    this.scrollToBottom();
    return msg;
  }

  appendToAssistantMessage(text) {
    if (!this.currentAssistantMessage) {
      this.startAssistantMessage();
    }

    // Remove typing indicator if present
    const typing = this.currentAssistantMessage.contentDiv.querySelector('.typing-indicator');
    if (typing) {
      typing.remove();
    }

    this.currentAssistantMessage.content += text;

    // Render markdown
    this.currentAssistantMessage.contentDiv.innerHTML =
      renderMarkdown(this.currentAssistantMessage.content);

    this.scrollToBottom();
  }

  finishAssistantMessage() {
    if (this.currentAssistantMessage) {
      // Remove any remaining typing indicator
      const typing = this.currentAssistantMessage.contentDiv.querySelector('.typing-indicator');
      if (typing) {
        typing.remove();
      }

      // Final render
      if (this.currentAssistantMessage.content) {
        this.currentAssistantMessage.contentDiv.innerHTML =
          renderMarkdown(this.currentAssistantMessage.content);
      }

      this.messages.push({
        role: 'assistant',
        content: this.currentAssistantMessage.content,
        element: this.currentAssistantMessage.element
      });

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

    const toolUseId = data.toolUseId;
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
            onResponse(toolUseId, { answers: responses });
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
          onResponse(toolUseId, { answers: responses });
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
          onResponse(toolUseId, { answers: responses });
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
      onResponse(toolUseId, { answers: {}, cancelled: true });
    });
    promptContainer.appendChild(cancelBtn);

    this.container.appendChild(promptContainer);
    this.currentPrompt = promptContainer;
    this.scrollToBottom();
  }

  removePrompt() {
    if (this.currentPrompt) {
      this.currentPrompt.remove();
      this.currentPrompt = null;
    }
  }

  showPermissionPrompt(data, onResponse) {
    this.removePrompt();

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
      this.removePrompt();
      onResponse(requestId, 'allow', toolInput);
    });

    // Allow All button
    const allowAllBtn = document.createElement('button');
    allowAllBtn.className = 'btn btn-secondary permission-btn';
    allowAllBtn.textContent = 'Allow All';
    allowAllBtn.title = 'Allow this tool for the rest of the session';
    allowAllBtn.addEventListener('click', () => {
      this.removePrompt();
      onResponse(requestId, 'allow_all', toolInput);
    });

    // Deny button
    const denyBtn = document.createElement('button');
    denyBtn.className = 'btn btn-danger permission-btn';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => {
      this.removePrompt();
      onResponse(requestId, 'deny', toolInput);
    });

    buttonsDiv.appendChild(allowBtn);
    buttonsDiv.appendChild(allowAllBtn);
    buttonsDiv.appendChild(denyBtn);
    promptContainer.appendChild(buttonsDiv);

    this.container.appendChild(promptContainer);
    this.currentPrompt = promptContainer;
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
