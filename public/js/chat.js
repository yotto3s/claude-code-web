// Chat UI Components

class ChatUI {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.currentAssistantMessage = null;
    this.currentToolIndicator = null;
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
