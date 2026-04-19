// url-input.js — URL/file entry. Accepts paste-a-URL and drag-drop/click-to-browse
// for PDF + image files, wired through onSubmit / onFileSubmit.

const ACCEPTED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const ACCEPTED_ATTR = '.pdf,image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function renderUrlInput(container, { onSubmit, onFileSubmit }) {
  container.innerHTML = `
    <div class="url-input-wrapper" id="url-input-wrapper">
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
        <span>Supports: URLs (localhost, staging, production), PDFs, and images.</span>
        <button class="url-input-browse" id="url-browse">Select files…</button>
        <input type="file" id="url-file-picker" accept="${ACCEPTED_ATTR}" hidden>
      </div>
      <div class="url-input-error" id="url-error" style="display:none"></div>
      <div class="url-input-drop-hint" id="url-input-drop-hint">Drop to upload</div>
    </div>
  `;

  const wrapper = container.querySelector('#url-input-wrapper');
  const urlField = container.querySelector('#url-field');
  const nameField = container.querySelector('#name-field');
  const submitBtn = container.querySelector('#url-submit');
  const errorEl = container.querySelector('#url-error');
  const browseBtn = container.querySelector('#url-browse');
  const picker = container.querySelector('#url-file-picker');

  const setError = (msg) => {
    if (msg) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
    else { errorEl.textContent = ''; errorEl.style.display = 'none'; }
  };

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

  function submitUrl() {
    const url = urlField.value.trim();
    const name = nameField.value.trim() || urlField.value.trim().split('/').pop() || 'Untitled';
    if (!url) { setError('Enter a URL'); return; }

    try {
      const parsed = new URL(url.startsWith('http') ? url : 'http://' + url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only HTTP/HTTPS URLs supported');
      }
      setError('');
      onSubmit(name, 'url', parsed.toString());
    } catch (e) {
      setError(e.message || 'Invalid URL');
    }
  }

  submitBtn.addEventListener('click', submitUrl);
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrl(); });
  nameField.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitUrl(); });

  // ─── File handling (picker + drop) ────────────────────────────────────────

  if (!onFileSubmit) return; // No file handler wired → url-only mode

  browseBtn.addEventListener('click', () => picker.click());
  picker.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    picker.value = '';
  });

  // Drag-and-drop. Highlight the wrapper on dragover, clear on leave/drop.
  let dragDepth = 0;
  wrapper.addEventListener('dragenter', (e) => {
    if (!hasFileItem(e.dataTransfer)) return;
    e.preventDefault();
    dragDepth++;
    wrapper.classList.add('dragover');
  });
  wrapper.addEventListener('dragover', (e) => {
    if (!hasFileItem(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  wrapper.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) wrapper.classList.remove('dragover');
  });
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    wrapper.classList.remove('dragover');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  function handleFile(file) {
    setError('');
    const mime = inferMime(file);
    if (!ACCEPTED_MIME.includes(mime)) {
      setError(`Unsupported file type: ${mime || file.type || 'unknown'}`);
      return;
    }
    if (file.size === 0) { setError('File is empty'); return; }
    if (file.size > MAX_FILE_BYTES) {
      setError(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
      return;
    }
    const contentType = mime === 'application/pdf' ? 'pdf' : 'image';
    const name = nameField.value.trim() || file.name.replace(/\.[^.]+$/, '') || 'Untitled';
    readAsBase64(file).then((data) => {
      onFileSubmit(name, contentType, file.name, data);
    }).catch((err) => setError(err.message || 'Could not read file'));
  }
}

function hasFileItem(dt) {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  return false;
}

function inferMime(file) {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  // Fallback by extension.
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  return {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }[ext] || '';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is "data:<mime>;base64,<payload>". Strip prefix.
      const comma = typeof result === 'string' ? result.indexOf(',') : -1;
      if (comma < 0) return reject(new Error('Could not read file bytes'));
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}
