/**
 * Slash Command Autocomplete Module
 * Provides autocomplete functionality for Claude Code slash commands
 */

class SlashCommandAutocomplete {
  constructor(options) {
    this.textarea = options.textarea;
    this.container = options.container; // .input-field div
    this.onExecute = options.onExecute; // Callback when command is selected

    // Complete list of Claude Code slash commands
    this.commands = [
      { name: '/add-dir', description: 'Add additional working directories' },
      { name: '/agents', description: 'Manage custom AI subagents' },
      { name: '/bashes', description: 'List background tasks' },
      { name: '/bug', description: 'Report bugs to Anthropic' },
      { name: '/clear', description: 'Clear conversation history' },
      { name: '/compact', description: 'Compact conversation' },
      { name: '/config', description: 'Open settings' },
      { name: '/context', description: 'Show context usage' },
      { name: '/cost', description: 'Show token usage' },
      { name: '/doctor', description: 'Check installation health' },
      { name: '/exit', description: 'Exit the REPL' },
      { name: '/export', description: 'Export conversation' },
      { name: '/help', description: 'Show help' },
      { name: '/hooks', description: 'Manage hook configurations' },
      { name: '/ide', description: 'Manage IDE integrations' },
      { name: '/init', description: 'Initialize CLAUDE.md' },
      { name: '/install-github-app', description: 'Setup GitHub Actions' },
      { name: '/login', description: 'Switch accounts' },
      { name: '/logout', description: 'Sign out' },
      { name: '/mcp', description: 'Manage MCP servers' },
      { name: '/memory', description: 'Edit CLAUDE.md' },
      { name: '/model', description: 'Change model' },
      { name: '/output-style', description: 'Set output style' },
      { name: '/permissions', description: 'View/update permissions' },
      { name: '/plan', description: 'Enter plan mode' },
      { name: '/plugin', description: 'Manage plugins' },
      { name: '/pr-comments', description: 'View PR comments' },
      { name: '/privacy-settings', description: 'Update privacy settings' },
      { name: '/release-notes', description: 'View release notes' },
      { name: '/rename', description: 'Rename session' },
      { name: '/remote-env', description: 'Configure remote env' },
      { name: '/resume', description: 'Resume conversation' },
      { name: '/review', description: 'Request code review' },
      { name: '/rewind', description: 'Rewind conversation' },
      { name: '/sandbox', description: 'Enable sandboxed bash' },
      { name: '/security-review', description: 'Security review changes' },
      { name: '/stats', description: 'Show usage stats' },
      { name: '/status', description: 'Show status' },
      { name: '/statusline', description: 'Setup status line' },
      { name: '/teleport', description: 'Resume remote session' },
      { name: '/terminal', description: 'Toggle terminal panel' },
      { name: '/terminal-setup', description: 'Install key bindings' },
      { name: '/theme', description: 'Change color theme' },
      { name: '/todos', description: 'List TODO items' },
      { name: '/usage', description: 'Show plan usage' },
      { name: '/vim', description: 'Toggle vim mode' }
    ];

    this.dropdown = null;
    this.selectedIndex = -1;
    this.filteredCommands = [];
    this.isVisible = false;

    this.init();
  }

  init() {
    this.createDropdown();
    this.attachEventListeners();
  }

  createDropdown() {
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'slash-autocomplete';
    this.dropdown.id = 'slash-autocomplete';
    this.dropdown.setAttribute('role', 'listbox');
    this.dropdown.setAttribute('aria-label', 'Slash commands');
    this.container.appendChild(this.dropdown);
  }

  attachEventListeners() {
    // Input event for detecting slash and filtering
    this.textarea.addEventListener('input', (e) => this.handleInput(e));

    // Keydown for navigation (arrow keys, enter, tab, escape)
    this.textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.hide();
      }
    });

    // Focus loss hides dropdown (with delay to allow click on dropdown item)
    this.textarea.addEventListener('blur', () => {
      setTimeout(() => {
        if (!this.dropdown.contains(document.activeElement)) {
          this.hide();
        }
      }, 150);
    });
  }

  handleInput() {
    const value = this.textarea.value;
    const cursorPos = this.textarea.selectionStart;

    // Get text before cursor
    const textBeforeCursor = value.substring(0, cursorPos);

    // Check if we're at start of input and typing a slash command
    const match = textBeforeCursor.match(/^\/(\S*)$/);

    if (match) {
      const query = match[1].toLowerCase();
      this.filterAndShow(query);
    } else {
      this.hide();
    }
  }

  handleKeydown(e) {
    if (!this.isVisible) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectNext();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectPrevious();
        break;
      case 'Enter':
      case 'Tab':
        if (this.selectedIndex >= 0 && this.filteredCommands[this.selectedIndex]) {
          e.preventDefault();
          this.selectCommand(this.filteredCommands[this.selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.hide();
        break;
    }
  }

  filterAndShow(query) {
    this.filteredCommands = this.commands.filter(cmd =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query)
    );

    if (this.filteredCommands.length === 0) {
      this.hide();
      return;
    }

    this.selectedIndex = 0;
    this.render();
    this.show();
  }

  render() {
    this.dropdown.innerHTML = '';

    this.filteredCommands.forEach((cmd, index) => {
      const item = document.createElement('div');
      item.className = 'slash-autocomplete-item' + (index === this.selectedIndex ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === this.selectedIndex);
      item.dataset.index = index;

      item.innerHTML = `
        <span class="slash-command-name">${this.escapeHtml(cmd.name)}</span>
        <span class="slash-command-desc">${this.escapeHtml(cmd.description)}</span>
      `;

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectCommand(cmd);
      });

      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      this.dropdown.appendChild(item);
    });
  }

  selectNext() {
    if (this.selectedIndex < this.filteredCommands.length - 1) {
      this.selectedIndex++;
      this.updateSelection();
    }
  }

  selectPrevious() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.updateSelection();
    }
  }

  updateSelection() {
    const items = this.dropdown.querySelectorAll('.slash-autocomplete-item');
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === this.selectedIndex);
      item.setAttribute('aria-selected', i === this.selectedIndex);
    });

    // Scroll into view if needed
    if (items[this.selectedIndex]) {
      items[this.selectedIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  selectCommand(cmd) {
    // Replace input with command
    this.textarea.value = cmd.name + ' ';
    this.textarea.focus();

    // Move cursor to end
    const len = this.textarea.value.length;
    this.textarea.setSelectionRange(len, len);

    // Trigger input event for auto-resize
    this.textarea.dispatchEvent(new Event('input', { bubbles: true }));

    this.hide();

    // Execute callback if provided
    if (this.onExecute) {
      this.onExecute(cmd);
    }
  }

  show() {
    this.dropdown.classList.add('show');
    this.isVisible = true;
    this.textarea.setAttribute('aria-expanded', 'true');
    this.textarea.setAttribute('aria-controls', 'slash-autocomplete');
  }

  hide() {
    this.dropdown.classList.remove('show');
    this.isVisible = false;
    this.selectedIndex = -1;
    this.textarea.removeAttribute('aria-expanded');
    this.textarea.removeAttribute('aria-controls');
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Method to add new commands dynamically
  addCommand(command) {
    this.commands.push(command);
  }

  // Method to remove a command
  removeCommand(name) {
    this.commands = this.commands.filter(c => c.name !== name);
  }
}

// Export for use in app.js
window.SlashCommandAutocomplete = SlashCommandAutocomplete;
