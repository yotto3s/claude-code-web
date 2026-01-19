// Markdown rendering configuration

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {}
    }
    return hljs.highlightAuto(code).value;
  },
});

// Custom renderer for code blocks
const renderer = new marked.Renderer();

renderer.code = function (code, language) {
  const lang = language || 'plaintext';
  let highlighted;

  try {
    if (hljs.getLanguage(lang)) {
      highlighted = hljs.highlight(code, { language: lang }).value;
    } else {
      highlighted = hljs.highlightAuto(code).value;
    }
  } catch {
    highlighted = escapeHtml(code);
  }

  const id = 'code-' + Math.random().toString(36).substr(2, 9);

  return `
    <div class="code-block">
      <div class="code-header">
        <span class="code-language">${escapeHtml(lang)}</span>
        <button class="copy-btn" onclick="copyCode('${id}')">Copy</button>
      </div>
      <pre><code id="${id}" class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>
    </div>
  `;
};

marked.use({ renderer });

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyCode(id) {
  const codeElement = document.getElementById(id);
  if (!codeElement) return;

  const text = codeElement.textContent;

  navigator.clipboard
    .writeText(text)
    .then(() => {
      // Find the copy button
      const btn = codeElement.closest('.code-block').querySelector('.copy-btn');
      if (btn) {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      }
    })
    .catch((err) => {
      console.error('Failed to copy:', err);
    });
}

function renderMarkdown(text) {
  if (!text) return '';
  return marked.parse(text);
}

// Make functions available globally
window.renderMarkdown = renderMarkdown;
window.copyCode = copyCode;
