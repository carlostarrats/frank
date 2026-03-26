// home.js — Project picker view

import sync from '../core/sync.js';

export function renderHome(container, { onOpenProject, onCreateProject }) {
  container.innerHTML = `
    <div class="home">
      <div class="home-header">
        <h1 class="home-title">Frank</h1>
        <button class="home-new-btn">New Project</button>
      </div>
      <div class="home-projects"></div>
    </div>
  `;

  const projectsList = container.querySelector('.home-projects');
  const newBtn = container.querySelector('.home-new-btn');

  newBtn.addEventListener('click', () => {
    // Replace button with inline input
    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex;gap:8px;align-items:center;';
    inputWrap.innerHTML = `
      <input class="home-name-input" type="text" placeholder="Project name..." autofocus
        style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);font-size:14px;font-family:inherit;flex:1;">
      <button class="home-create-confirm" style="padding:8px 16px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;font-size:13px;font-family:inherit;">Create</button>
      <button class="home-create-cancel" style="padding:8px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-secondary);cursor:pointer;font-size:13px;font-family:inherit;">Cancel</button>
    `;
    newBtn.replaceWith(inputWrap);
    const input = inputWrap.querySelector('.home-name-input');
    input.focus();

    function submit() {
      const label = input.value.trim();
      if (label) onCreateProject(label);
      inputWrap.replaceWith(newBtn);
    }

    inputWrap.querySelector('.home-create-confirm').addEventListener('click', submit);
    inputWrap.querySelector('.home-create-cancel').addEventListener('click', () => inputWrap.replaceWith(newBtn));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') inputWrap.replaceWith(newBtn);
    });
  });

  loadProjects();

  async function loadProjects() {
    try {
      console.log('[home] loading projects...');
      const projects = await sync.listProjects();
      console.log('[home] got projects:', projects);
      if (projects.length === 0) {
        projectsList.innerHTML = '<p class="home-empty">No projects yet. Create one to get started.</p>';
        return;
      }
      projectsList.innerHTML = projects.map(p => `
        <div class="home-project-card" data-path="${encodeURIComponent(p.filePath)}">
          <div class="home-project-info">
            <span class="home-project-label">${escapeHtml(p.label)}</span>
            <span class="home-project-meta">${p.screenCount} screen${p.screenCount !== 1 ? 's' : ''} · ${formatDate(p.modifiedAt)}${p.unseenNotes > 0 ? ` <span class="home-badge">${p.unseenNotes} new</span>` : ''}</span>
          </div>
        </div>
      `).join('');

      projectsList.querySelectorAll('.home-project-card').forEach(card => {
        card.addEventListener('click', () => {
          const path = decodeURIComponent(card.dataset.path);
          onOpenProject(path);
        });
      });
    } catch (e) {
      console.error('[home] loadProjects error:', e);
      projectsList.innerHTML = `<p class="home-empty">Unable to load projects. Is the daemon running? (${e.message})</p>`;
    }
  }

  return { refresh: loadProjects };
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
