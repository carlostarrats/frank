// curation.js — Curation panel: approve, dismiss, remix, batch comments
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { toastInfo, toastError } from './toast.js';
import { showConfirm } from './confirm.js';

let selectedIds = new Set();
let filterMode = 'all'; // all | pending | approved | dismissed
let editingId = null;  // id of the comment currently being edited in-place
let focusedId = null;  // id of the comment currently "focused" (pulsing pin)
// Cached canvas state kept fresh so Copy for AI can run synchronously inside
// the click handler — awaiting inside the handler expires the user-gesture
// that clipboard APIs require.
let cachedCanvasState = null;

// Must match PIN_PALETTE in canvas/comments.js so the badge color next to
// a feedback item matches its canvas pin.
const PIN_PALETTE = [
  '#f0b429', '#3b82f6', '#10b981', '#ef4444', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export function renderCuration(container, { screenId, onClose }) {
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
          <h3>Feedback (${allComments.length}${selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''})</h3>
          ${onClose ? '<button type="button" class="curation-close" aria-label="Close feedback panel" title="Close feedback">✕</button>' : ''}
        </div>
        <div class="curation-filters">
          ${['all', 'pending', 'approved', 'dismissed'].map(f =>
            `<button class="curation-filter ${filterMode === f ? 'active' : ''}" data-filter="${f}">${f}</button>`
          ).join('')}
        </div>
        <div class="curation-list" id="curation-list">
          ${comments.length === 0
            ? '<p class="curation-empty">No comments</p>'
            : comments.map(c => {
                const isEditing = editingId === c.id;
                // Pin number matches the canvas pin: position in the full
                // (unfiltered) comment list. Colors from PIN_PALETTE cycled
                // the same way canvas/comments.js does.
                const pinIdx = allComments.findIndex(x => x.id === c.id);
                const pinColor = PIN_PALETTE[pinIdx % PIN_PALETTE.length];
                return `
                <div class="curation-item ${selectedIds.has(c.id) ? 'selected' : ''} ${focusedId === c.id ? 'focused' : ''} curation-status-${c.status}" data-id="${c.id}">
                  <div class="curation-item-header">
                    <label class="curation-check">
                      <input type="checkbox" ${selectedIds.has(c.id) ? 'checked' : ''} data-id="${c.id}">
                    </label>
                    <span class="curation-pin-badge" style="background:${pinColor}" title="Pin ${pinIdx + 1}">${pinIdx + 1}</span>
                    <strong>${esc(c.author)}</strong>
                    <span class="curation-badge curation-badge-${c.status}">${c.status}</span>
                    <span class="curation-time">${timeAgo(c.ts)}</span>
                  </div>
                  ${isEditing
                    ? `<textarea class="input curation-text-edit" data-id="${c.id}" rows="3" aria-label="Edit comment text">${esc(c.text)}</textarea>`
                    : `<p class="curation-text">${esc(c.text)}</p>`}
                  ${c.anchor?.cssSelector ? `<span class="curation-anchor">${esc(c.anchor.cssSelector)}</span>` : ''}
                  <div class="curation-actions">
                    ${isEditing
                      ? `
                        <button class="curation-act curation-act-primary" data-action="edit-save" data-id="${c.id}" title="Save edit">Save</button>
                        <button class="curation-act" data-action="edit-cancel" data-id="${c.id}" title="Cancel edit">Cancel</button>
                      `
                      : `
                        <button class="curation-act ${c.status === 'approved' ? 'on' : ''}" data-action="approve" data-id="${c.id}" title="${c.status === 'approved' ? 'Reset to pending' : 'Approve'}">✓</button>
                        <button class="curation-act ${c.status === 'dismissed' ? 'on' : ''}" data-action="dismiss" data-id="${c.id}" title="${c.status === 'dismissed' ? 'Reset to pending' : 'Dismiss'}">✕</button>
                        <button class="curation-act" data-action="edit" data-id="${c.id}" title="Edit / rewrite">✎</button>
                        <button class="curation-act" data-action="copy-ai" data-id="${c.id}" ${c.status !== 'approved' ? 'disabled' : ''} title="${c.status === 'approved' ? 'Copy this comment for AI' : 'Approve this comment first to copy it for AI'}">↗ AI</button>
                      `}
                  </div>
                </div>
              `;
              }).join('')
          }
        </div>
        ${(() => {
          // Panel-level actions. "Copy approved for AI" is always visible so
          // users learn the affordance exists; it's disabled until at least
          // one comment is approved (pending / dismissed would just be noise
          // for an AI handoff). Delete only appears when the user has a
          // selection, mirroring the old batch behavior.
          const approvedCount = allComments.filter(c => c.status === 'approved').length;
          return `
          <div class="curation-batch">
            <button class="btn-primary" id="batch-send" ${approvedCount === 0 ? 'disabled' : ''} title="${approvedCount === 0 ? 'Approve at least one comment to copy for AI' : `Copy ${approvedCount} approved comment${approvedCount === 1 ? '' : 's'} + project context for AI`}">Copy approved for AI${approvedCount > 0 ? ` (${approvedCount})` : ''}</button>
            ${selectedIds.size > 0 ? `
              <button class="btn-ghost curation-batch-delete" id="batch-delete">Delete ${selectedIds.size}</button>
            ` : ''}
          </div>
        `;
        })()}
        <div class="comment-input-area" id="comment-input-area" style="display:none">
          <textarea class="input comment-textarea" id="comment-text" placeholder="Add a comment..." rows="3" aria-label="New comment"></textarea>
          <div class="comment-input-actions">
            <button class="btn-ghost" id="cancel-comment">Cancel</button>
            <button class="btn-primary" id="submit-comment">Comment</button>
          </div>
        </div>
      </div>
    `;

    // Close button (only present when onClose was provided)
    const closeBtn = container.querySelector('.curation-close');
    if (closeBtn && onClose) closeBtn.addEventListener('click', onClose);

    // Filters
    container.querySelectorAll('.curation-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        filterMode = btn.dataset.filter;
        render();
      });
    });

    // Click a row (not its buttons/checkbox/textarea) to focus that comment:
    // the row highlights and the matching canvas pin pulses continuously.
    // Click again to clear focus.
    container.querySelectorAll('.curation-item').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button, input, textarea, label')) return;
        const id = row.dataset.id;
        focusedId = focusedId === id ? null : id;
        render();
        window.dispatchEvent(new CustomEvent('frank:focus-comment-pin', { detail: { id: focusedId } }));
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
        if (btn.disabled) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;

        if (action === 'copy-ai') {
          copyCommentsForAi([id]);
          return;
        }

        if (action === 'edit') {
          editingId = id;
          render();
          queueMicrotask(() => {
            const ta = container.querySelector(`.curation-text-edit[data-id="${id}"]`);
            if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
          });
          return;
        }
        if (action === 'edit-cancel') {
          editingId = null;
          render();
          return;
        }
        if (action === 'edit-save') {
          const ta = container.querySelector(`.curation-text-edit[data-id="${id}"]`);
          const text = ta ? ta.value.trim() : '';
          if (text) sync.curateComment([id], 'remix', text);
          editingId = null;
          return;
        }

        // approve / dismiss are toggles: clicking the current status resets
        // to pending. Clicking the opposite status switches. This lets the
        // user always change their mind without a separate "undo" control.
        const target = projectManager.getComments().find(c => c.id === id);
        const currentStatus = target?.status;
        const targetStatus = action === 'approve' ? 'approved' : 'dismissed';
        const actionToSend = currentStatus === targetStatus ? 'reset' : action;
        sync.curateComment([id], actionToSend);
      });
    });

    // Keyboard shortcuts inside the edit textarea.
    container.querySelectorAll('.curation-text-edit').forEach(ta => {
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          const id = ta.dataset.id;
          const text = ta.value.trim();
          if (text) sync.curateComment([id], 'remix', text);
          editingId = null;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          editingId = null;
          render();
        }
      });
    });

    // Panel-level: copy every approved comment in the current screen.
    // Intentionally ignores the selection — the button label is "Copy
    // approved for AI", not "Copy selected." Single-comment handoff lives
    // on the per-row ↗ AI button. Uses `allComments` from the render
    // closure so the scope matches the button's count label.
    container.querySelector('#batch-send')?.addEventListener('click', (e) => {
      if (e.currentTarget.disabled) return;
      const approvedIds = allComments
        .filter(c => c.status === 'approved')
        .map(c => c.id);
      if (approvedIds.length === 0) return;
      copyCommentsForAi(approvedIds);
    });
    container.querySelector('#batch-delete')?.addEventListener('click', async () => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      const title = ids.length === 1 ? 'Delete this comment?' : `Delete ${ids.length} comments?`;
      const ok = await showConfirm({
        title,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      for (const id of ids) sync.deleteComment(id);
      selectedIds.clear();
      render();
    });
  }

  render();
  projectManager.onChange(render);

  // Keep canvas state cached so the Copy for AI click handler can run without
  // async gaps that would break clipboard permissions. Refresh on mount and
  // on every project change (curate/delete/comment-add all trigger one).
  const refreshCanvasCache = () => {
    const p = projectManager.get();
    if (!p || p.contentType !== 'canvas') { cachedCanvasState = null; return; }
    sync.loadCanvasState().then(msg => {
      cachedCanvasState = msg?.state || null;
    }).catch(() => { cachedCanvasState = null; });
  };
  refreshCanvasCache();
  projectManager.onChange(refreshCanvasCache);

  // External request: pin popover "Edit" button → open panel, enter edit mode
  // for that comment, scroll + focus the textarea.
  const onEditRequest = (e) => {
    const id = e.detail?.id;
    if (!id) return;
    container.classList.add('open');
    // Ensure the requested comment is visible even if a filter excludes it.
    const target = projectManager.getComments().find(c => c.id === id);
    if (target && filterMode !== 'all' && target.status !== filterMode) {
      filterMode = 'all';
    }
    editingId = id;
    render();
    queueMicrotask(() => {
      const row = container.querySelector(`.curation-item[data-id="${id}"]`);
      const ta = container.querySelector(`.curation-text-edit[data-id="${id}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  };
  window.addEventListener('frank:edit-comment', onEditRequest);

  return () => {
    projectManager.offChange(render);
    window.removeEventListener('frank:edit-comment', onEditRequest);
  };
}

// Format the given comments as a self-contained markdown payload and copy
// to the clipboard. Callers are:
//   • Per-row ↗ AI button  — passes a single comment id
//   • "Copy approved for AI" panel button — passes every approved id
// The payload is designed to be pasted into any AI chat that can act on
// feedback — it bundles project meta, intent, canvas shape JSON, and per-pin
// anchor info so the model can reason about what the reviewer actually meant
// and return code/markup if asked.
function copyCommentsForAi(commentIds) {
  const allComments = projectManager.getComments();
  const comments = allComments.filter(c => commentIds.includes(c.id));
  if (comments.length === 0) return;

  const project = projectManager.get() || {};
  const lines = [];

  lines.push('# Frank — reviewer feedback for AI');
  lines.push('');
  lines.push('This export bundles project context + reviewer comments so the AI can take action.');
  lines.push('If the feedback requests changes, return the updated code / markup. Reference pin numbers in your response.');
  lines.push('');

  lines.push('## Project');
  lines.push(`- Name: ${project.name || '(untitled)'}`);
  lines.push(`- Type: ${project.contentType || 'unknown'}`);
  if (project.url) lines.push(`- URL: ${project.url}`);
  if (project.file) lines.push(`- File: ${project.file}`);
  if (project.modified) lines.push(`- Modified: ${project.modified}`);
  lines.push('');

  // Project brief — the user's stated goal for the work. Placed high up so
  // the AI reads the reviewer feedback against this frame.
  if (project.intent && project.intent.trim()) {
    lines.push('## Project brief');
    lines.push('');
    lines.push(project.intent.trim());
    lines.push('');
  }

  // Canvas state from the eagerly-refreshed cache — keeps this fully sync so
  // the clipboard write still counts as user-gesture-initiated.
  let shapeIndex = null;
  if (project.contentType === 'canvas' && cachedCanvasState) {
    lines.push('## Canvas state (Konva JSON)');
    lines.push('```json');
    lines.push(JSON.stringify(cachedCanvasState, null, 2));
    lines.push('```');
    lines.push('');
    shapeIndex = buildShapeIndex(cachedCanvasState);
  }

  lines.push(`## Reviewer feedback (${comments.length})`);
  lines.push('');
  for (const c of comments) {
    const pinIdx = allComments.findIndex(x => x.id === c.id);
    const pinNum = pinIdx >= 0 ? pinIdx + 1 : '?';
    lines.push(`### Pin ${pinNum} — ${c.author}`);
    lines.push(`- Status: ${c.status}`);
    if (c.anchor?.type === 'shape') {
      const target = shapeIndex?.get(c.anchor.shapeId);
      lines.push(`- Anchor: shape \`${c.anchor.shapeId}\` at (${Math.round(c.anchor.x)}, ${Math.round(c.anchor.y)})`);
      if (target) {
        lines.push(`- Target: ${describeShape(target)}`);
        lines.push('- Target shape JSON:');
        lines.push('```json');
        lines.push(JSON.stringify(target, null, 2));
        lines.push('```');
      }
    } else if (c.anchor?.type === 'pin') {
      lines.push(`- Anchor: free pin at (${Math.round(c.anchor.x)}, ${Math.round(c.anchor.y)}) — no shape attached`);
    } else if (c.anchor?.cssSelector) {
      lines.push(`- Anchor: \`${c.anchor.cssSelector}\``);
      if (c.anchor.domPath) lines.push(`- DOM path: \`${c.anchor.domPath}\``);
      if (typeof c.anchor.x === 'number') lines.push(`- Visual coords: (${Math.round(c.anchor.x)}, ${Math.round(c.anchor.y)})`);
    }
    lines.push('');
    const body = (c.remixedText || c.text || '').split('\n').map(l => `> ${l}`).join('\n');
    lines.push(body);
    lines.push('');
  }

  const prompt = lines.join('\n');
  if (copyTextToClipboard(prompt)) {
    sync.logAiInstruction(commentIds, [], prompt).catch(() => {});
    toastInfo(`Copied ${comments.length} comment${comments.length === 1 ? '' : 's'} + project context`);
  } else {
    toastError('Clipboard copy failed — check browser permissions');
  }
}

// Robust clipboard copy that works even when called after an async gap that
// invalidates the original user-gesture requirement on navigator.clipboard.
// Uses a hidden textarea + execCommand as the fallback path.
function copyTextToClipboard(text) {
  // Try the async API first; if it rejects we fall through to execCommand.
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch { /* ignore */ }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Walk the Konva serialized tree and index every node that has an id, so a
// comment anchored to a shape id can be resolved in O(1). Works for both
// top-level shapes and shapes nested inside groups (templates, etc.).
function buildShapeIndex(state) {
  const idx = new Map();
  const visit = (node) => {
    if (!node) return;
    const id = node.attrs?.id;
    if (id) idx.set(id, node);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  };
  visit(state);
  return idx;
}

// Human-readable one-liner summary of a Konva node — gives the AI a quick
// read of what the shape is (type + rough size + position) before it parses
// the full JSON.
function describeShape(node) {
  const k = node.className || 'Node';
  const a = node.attrs || {};
  const pos = (typeof a.x === 'number' && typeof a.y === 'number')
    ? ` at (${Math.round(a.x)}, ${Math.round(a.y)})` : '';
  let size = '';
  if (typeof a.radius === 'number') size = ` r=${Math.round(a.radius)}`;
  else if (typeof a.radiusX === 'number' && typeof a.radiusY === 'number') size = ` rx=${Math.round(a.radiusX)} ry=${Math.round(a.radiusY)}`;
  else if (typeof a.width === 'number' && typeof a.height === 'number') size = ` ${Math.round(a.width)}×${Math.round(a.height)}`;
  const fill = a.fill ? ` fill=${a.fill}` : '';
  const stroke = a.stroke ? ` stroke=${a.stroke}` : '';
  const rot = a.rotation ? ` rotation=${Math.round(a.rotation)}°` : '';
  const text = a.text ? ` text=${JSON.stringify(a.text.slice(0, 40))}` : '';
  return `${k}${size}${pos}${rot}${fill}${stroke}${text}`.trim();
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
function timeAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60);
  if (h < 24) return h + 'h'; return Math.floor(h / 24) + 'd';
}
