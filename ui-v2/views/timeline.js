// timeline.js — Chronological view of snapshots, comments, curations, AI instructions
import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { iconDownload } from '../components/toolbar.js';

export function renderTimeline(container, { onBack }) {
  container.innerHTML = `
    <div class="toolbar">
      <span class="toolbar-title">Timeline</span>
      <div class="toolbar-spacer"></div>
      <button class="toolbar-btn" id="timeline-reveal" title="Show project folder on disk">Show folder</button>
      <div class="timeline-export-wrapper">
        <button class="toolbar-btn toolbar-icon-btn" id="timeline-export-btn" title="Export" aria-label="Export">${iconDownload()}</button>
        <div class="timeline-export-menu" id="timeline-export-menu" hidden>
          <button data-format="json" class="timeline-export-item">JSON</button>
          <button data-format="markdown" class="timeline-export-item">Markdown</button>
          <button data-format="pdf" class="timeline-export-item">PDF</button>
        </div>
      </div>
      <span class="toolbar-close-gap"></span>
      <button class="toolbar-btn toolbar-comment-btn" id="timeline-back" title="Close timeline" aria-label="Close timeline">✕</button>
    </div>
    <div class="timeline-body" id="timeline-body">
      <div class="viewer-loading">Loading timeline...</div>
    </div>
  `;

  container.querySelector('#timeline-back').addEventListener('click', onBack);
  container.querySelector('#timeline-reveal').addEventListener('click', async () => {
    const result = await sync.revealProjectFolder();
    if (result?.type === 'error') alert(`Could not open folder: ${result.error}`);
  });

  // Export dropdown — mirrors the canvas export menu: one download icon, a
  // popover menu with the three formats, click-outside closes.
  const exportBtn = container.querySelector('#timeline-export-btn');
  const exportMenu = container.querySelector('#timeline-export-menu');
  const closeExportMenu = () => exportMenu.setAttribute('hidden', '');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (exportMenu.hasAttribute('hidden')) exportMenu.removeAttribute('hidden');
    else closeExportMenu();
  });
  const onExportClickOutside = (e) => {
    if (!exportMenu.contains(e.target) && e.target !== exportBtn && !exportBtn.contains(e.target)) closeExportMenu();
  };
  document.addEventListener('click', onExportClickOutside);

  exportMenu.querySelectorAll('.timeline-export-item').forEach((item) => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeExportMenu();
      const format = item.dataset.format;
      const projectName = projectManager.get()?.name || 'project';
      try {
        if (format === 'json') {
          const result = await sync.exportProject();
          if (!result?.data) throw new Error('No data');
          const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
          downloadBlob(blob, `${projectName}-export.json`);
        } else if (format === 'markdown') {
          const result = await sync.exportReport('markdown');
          if (result.type === 'error') throw new Error(result.error);
          const blob = new Blob([result.data], { type: 'text/markdown' });
          downloadBlob(blob, `${projectName}.md`);
        } else if (format === 'pdf') {
          const result = await sync.exportReport('pdf');
          if (result.type === 'error') throw new Error(result.error);
          const bytes = Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'application/pdf' });
          downloadBlob(blob, `${projectName}.pdf`);
        }
      } catch (err) {
        alert(`Export failed: ${err.message || err}`);
      }
    });
  });

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
