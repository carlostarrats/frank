// home.js — Project list: create, open, delete
import sync from '../core/sync.js';
import { renderUrlInput } from '../components/url-input.js';

export function renderHome(container, { onOpenProject, onCreateProject }) {
  container.innerHTML = `
    <div class="home">
      <div class="home-header">
        <img src="frank-logo.svg" alt="Frank" class="home-logo">
        <span class="home-version">v1.0</span>
      </div>
      <div class="home-content">
        <div class="home-new" id="home-new"></div>
        <div class="home-projects" id="home-projects">
          <h3 class="home-section-title">Recent projects</h3>
          <div class="project-list" id="project-list">
            <div class="project-list-loading">Loading...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderUrlInput(container.querySelector('#home-new'), {
    onSubmit(name, contentType, url) {
      onCreateProject(name, contentType, url);
    },
  });

  sync.listProjects().then(data => {
    const list = container.querySelector('#project-list');
    const projects = data.projects || [];

    if (projects.length === 0) {
      list.innerHTML = '<p class="project-list-empty">No projects yet</p>';
      return;
    }

    list.innerHTML = projects.map(p => `
      <div class="project-card" data-id="${p.projectId}">
        <div class="project-card-info">
          <span class="project-card-name">${escapeHtml(p.name)}</span>
          <span class="project-card-meta">${p.contentType} · ${p.commentCount} comments · ${timeAgo(p.modified)}</span>
        </div>
        <div class="project-card-actions">
          <button class="btn-ghost project-delete" data-id="${p.projectId}" title="Delete">×</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.project-delete')) return;
        onOpenProject(card.dataset.id);
      });
    });

    list.querySelectorAll('.project-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete this project and all its data?')) {
          sync.deleteProject(btn.dataset.id).then(() => {
            renderHome(container, { onOpenProject, onCreateProject });
          });
        }
      });
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
