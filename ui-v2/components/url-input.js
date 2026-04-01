// url-input.js — URL/file input with validation and project creation

export function renderUrlInput(container, { onSubmit }) {
  container.innerHTML = `
    <div class="url-input-wrapper">
      <div class="url-input-header">
        <h2>What are you working on?</h2>
        <p class="url-input-subtitle">Paste a URL or drop a file to start collaborating</p>
      </div>
      <div class="url-input-form">
        <input
          type="text"
          class="input url-input-field"
          placeholder="https://localhost:3000 or any URL..."
          id="url-field"
          autofocus
        >
        <input
          type="text"
          class="input url-input-name"
          placeholder="Project name"
          id="name-field"
        >
        <button class="btn-primary" id="url-submit">Open</button>
      </div>
      <div class="url-input-hint">
        <span>Supports: URLs (localhost, staging, production), PDFs, and images</span>
      </div>
      <div class="url-input-error" id="url-error" style="display:none"></div>
    </div>
  `;

  const urlField = container.querySelector('#url-field');
  const nameField = container.querySelector('#name-field');
  const submitBtn = container.querySelector('#url-submit');
  const errorEl = container.querySelector('#url-error');

  urlField.addEventListener('input', () => {
    if (!nameField.value) {
      try {
        const url = new URL(urlField.value);
        nameField.placeholder = url.hostname || 'Project name';
      } catch {
        nameField.placeholder = 'Project name';
      }
    }
  });

  function submit() {
    const url = urlField.value.trim();
    const name = nameField.value.trim() || urlField.value.trim().split('/').pop() || 'Untitled';
    if (!url) {
      errorEl.textContent = 'Enter a URL';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const parsed = new URL(url.startsWith('http') ? url : 'http://' + url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only HTTP/HTTPS URLs supported');
      }
      errorEl.style.display = 'none';
      onSubmit(name, 'url', parsed.toString());
    } catch (e) {
      errorEl.textContent = e.message || 'Invalid URL';
      errorEl.style.display = 'block';
    }
  }

  submitBtn.addEventListener('click', submit);
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}
