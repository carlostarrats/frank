// timeline.js — Chronological view of snapshots, comments, curations, AI instructions
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function renderTimeline(container, { onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <span class="toolbar-title">Timeline</span>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn toolbar-comment-btn" id="timeline-back" title="Close timeline">✕</button>
      <button class="toolbar-btn" id="timeline-export">Export</button>
    </div>
    <div class="timeline-body" id="timeline-body">
      <div class="viewer-loading">Loading timeline...</div>
    </div>
  `;

  container.querySelector('#timeline-back').addEventListener('click', onBack);
  container.querySelector('#timeline-export').addEventListener('click', async () => {
    const result = await sync.exportProject();
    if (result.data) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectManager.get()?.name || 'project'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Load all data
  Promise.all([
    sync.listSnapshots(),
  ]).then(([snapshotData]) => {
    const body = container.querySelector('#timeline-body');
    const comments = projectManager.getComments();
    const snapshots = snapshotData.snapshots || [];

    // Build timeline items
    const items = [];
    for (const c of comments) {
      items.push({ type: 'comment', ts: c.ts, data: c });
    }
    for (const s of snapshots) {
      items.push({ type: 'snapshot', ts: s.ts, data: s });
    }
    items.sort((a, b) => b.ts.localeCompare(a.ts));

    if (items.length === 0) {
      body.innerHTML = '<div class="timeline-empty">No activity yet</div>';
      return;
    }

    body.innerHTML = `
      <div class="timeline-list">
        ${items.map(item => {
          if (item.type === 'comment') {
            const c = item.data;
            return `
              <div class="timeline-item timeline-comment">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <span class="timeline-badge">Comment</span>
                  <strong>${esc(c.author)}</strong>: ${esc(c.text)}
                  <div class="timeline-meta">${new Date(c.ts).toLocaleString()}</div>
                </div>
              </div>
            `;
          }
          if (item.type === 'snapshot') {
            const s = item.data;
            const projectId = projectManager.getId();
            const thumbUrl = s.canvasState && projectId
              ? `/files/projects/${projectId}/snapshots/${s.id}/thumbnail.png`
              : null;
            return `
              <div class="timeline-item timeline-snapshot">
                <div class="timeline-dot dot-snapshot"></div>
                <div class="timeline-content">
                  <span class="timeline-badge badge-snapshot">${s.starred ? '⭐ ' : ''}Snapshot</span>
                  ${s.canvasState ? '<span class="timeline-badge badge-canvas">Canvas</span>' : ''}
                  ${s.label ? `<strong>${esc(s.label)}</strong> — ` : ''}${s.trigger}
                  <div class="timeline-meta">${new Date(s.ts).toLocaleString()}</div>
                  ${thumbUrl ? `<img class="timeline-thumbnail" src="${thumbUrl}" alt="Snapshot thumbnail" onerror="this.remove()">` : ''}
                </div>
              </div>
            `;
          }
          return '';
        }).join('')}
      </div>
    `;
  });
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
