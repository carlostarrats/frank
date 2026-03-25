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

  newBtn.addEventListener('click', async () => {
    const label = prompt('Project name:');
    if (!label?.trim()) return;
    onCreateProject(label.trim());
  });

  loadProjects();

  async function loadProjects() {
    try {
      const projects = await sync.listProjects();
      if (projects.length === 0) {
        projectsList.innerHTML = '<p class="home-empty">No projects yet. Create one to get started.</p>';
        return;
      }
      projectsList.innerHTML = projects.map(p => `
        <div class="home-project-card" data-path="${encodeURIComponent(p.filePath)}">
          <div class="home-project-info">
            <span class="home-project-label">${escapeHtml(p.label)}</span>
            <span class="home-project-meta">${p.screenCount} screen${p.screenCount !== 1 ? 's' : ''} · ${formatDate(p.modifiedAt)}</span>
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
      projectsList.innerHTML = '<p class="home-empty">Unable to load projects. Is the daemon running?</p>';
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
