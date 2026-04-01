// curation.js — Curation panel: approve, dismiss, remix, batch comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

let selectedIds = new Set();
let filterMode = 'all'; // all | pending | approved | dismissed

export function renderCuration(container, { screenId, onCommentModeToggle }) {
  function render() {
    const allComments = screenId
      ? projectManager.getCommentsForScreen(screenId)
      : projectManager.getComments();

    const comments = filterMode === 'all'
      ? allComments
      : allComments.filter(c => c.status === filterMode);

    container.innerHTML = `
      <div class="curation-panel">
        <div class="curation-header">
          <h3>Feedback (${allComments.length})</h3>
          <button class="btn-ghost" id="toggle-comment-mode">+ Add</button>
        </div>
        <div class="curation-filters">
          ${['all', 'pending', 'approved', 'dismissed'].map(f =>
            `<button class="curation-filter ${filterMode === f ? 'active' : ''}" data-filter="${f}">${f}</button>`
          ).join('')}
        </div>
        <div class="curation-list" id="curation-list">
          ${comments.length === 0
            ? '<p class="curation-empty">No comments</p>'
            : comments.map(c => `
                <div class="curation-item ${selectedIds.has(c.id) ? 'selected' : ''} curation-status-${c.status}" data-id="${c.id}">
                  <div class="curation-item-header">
                    <label class="curation-check">
                      <input type="checkbox" ${selectedIds.has(c.id) ? 'checked' : ''} data-id="${c.id}">
                    </label>
                    <strong>${esc(c.author)}</strong>
                    <span class="curation-badge curation-badge-${c.status}">${c.status}</span>
                    <span class="curation-time">${timeAgo(c.ts)}</span>
                  </div>
                  <p class="curation-text">${esc(c.text)}</p>
                  ${c.anchor?.cssSelector ? `<span class="curation-anchor">${esc(c.anchor.cssSelector)}</span>` : ''}
                  <div class="curation-actions">
                    <button class="curation-act" data-action="approve" data-id="${c.id}" title="Approve">✓</button>
                    <button class="curation-act" data-action="dismiss" data-id="${c.id}" title="Dismiss">✕</button>
                    <button class="curation-act" data-action="remix" data-id="${c.id}" title="Remix">✎</button>
                  </div>
                </div>
              `).join('')
          }
        </div>
        ${selectedIds.size > 0 ? `
          <div class="curation-batch">
            <span>${selectedIds.size} selected</span>
            <button class="btn-ghost" id="batch-approve">Approve All</button>
            <button class="btn-ghost" id="batch-dismiss">Dismiss All</button>
            <button class="btn-primary" id="batch-send">Send to AI</button>
          </div>
        ` : ''}
        <div class="curation-remix-area" id="remix-area" style="display:none">
          <textarea class="input curation-remix-text" id="remix-text" placeholder="Rewrite in your own words..." rows="3"></textarea>
          <div class="curation-remix-actions">
            <button class="btn-ghost" id="remix-cancel">Cancel</button>
            <button class="btn-primary" id="remix-save">Save Remix</button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    container.querySelector('#toggle-comment-mode')?.addEventListener('click', onCommentModeToggle);

    // Filters
    container.querySelectorAll('.curation-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        render();
      });
    });

    // Checkboxes
    container.querySelectorAll('.curation-check input').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
        render();
      });
    });

    // Individual actions
    container.querySelectorAll('.curation-act').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'remix') {
          showRemixArea(container, [id]);
          return;
        }

        sync.curateComment([id], action);
      });
    });

    // Batch actions
    container.querySelector('#batch-approve')?.addEventListener('click', () => {
      sync.curateComment([...selectedIds], 'approve');
      selectedIds.clear();
    });
    container.querySelector('#batch-dismiss')?.addEventListener('click', () => {
      sync.curateComment([...selectedIds], 'dismiss');
      selectedIds.clear();
    });
    container.querySelector('#batch-send')?.addEventListener('click', () => {
      showAiRouting(container, [...selectedIds]);
    });
  }

  render();
  projectManager.onChange(render);
  return () => { projectManager.offChange(render); };
}

function showRemixArea(container, commentIds) {
  const area = container.querySelector('#remix-area');
  if (!area) return;
  area.style.display = 'block';
  area.querySelector('#remix-text')?.focus();

  area.querySelector('#remix-save')?.addEventListener('click', () => {
    const text = area.querySelector('#remix-text').value.trim();
    if (text) {
      sync.curateComment(commentIds, 'remix', text);
      area.style.display = 'none';
      area.querySelector('#remix-text').value = '';
    }
  });
  area.querySelector('#remix-cancel')?.addEventListener('click', () => {
    area.style.display = 'none';
    area.querySelector('#remix-text').value = '';
  });
}

function showAiRouting(container, commentIds) {
  const comments = projectManager.getComments().filter(c => commentIds.includes(c.id));
  const combined = comments.map(c => `[${c.author}]: ${c.text}`).join('\n');

  // Dispatch to AI routing component
  const event = new CustomEvent('frank:open-ai-routing', {
    detail: { commentIds, comments, combined },
  });
  window.dispatchEvent(event);
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60);
  if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd';
}
