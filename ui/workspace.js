// workspace.js — App shell: view router, state management
import sync from './core/sync.js';
import projectManager from './core/project.js';
import { renderHome } from './views/home.js';
import { renderGallery } from './views/gallery.js';
import { renderEditor } from './views/editor.js';

const state = {
  currentView: 'home',
  project: null,
  activeScreenId: null,
};

function switchView(view, params = {}) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  state.currentView = view;

  if (view === 'editor') {
    renderEditor(document.getElementById('view-editor'), {
      screenId: state.activeScreenId,
      onBack: () => switchView('gallery'),
    });
  }

  if (view === 'gallery') {
    renderGallery(document.getElementById('view-gallery'), {
      onSelectScreen(id) {
        state.activeScreenId = id;
        switchView('editor');
      },
      onAddScreen(label) {
        projectManager.addScreen({ label, platform: 'web', sections: [], notes: [], stars: [], context: '' });
        switchView('gallery');
      },
      onBack() {
        switchView('home');
      },
    });
  }
}

function init() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="workspace">
      <div id="view-home" class="view active"></div>
      <div id="view-gallery" class="view"></div>
      <div id="view-editor" class="view"></div>
    </div>
  `;
  // Debug: show connection status on screen
  const debugEl = document.createElement('div');
  debugEl.style.cssText = 'position:fixed;bottom:8px;left:8px;font-size:11px;color:#666;z-index:9999;';
  debugEl.textContent = 'Connecting...';
  document.body.appendChild(debugEl);

  sync.onReady(() => {
    debugEl.textContent = 'Connected to daemon';
    debugEl.style.color = '#4aff8b';
  });
  sync.onError((msg) => {
    debugEl.textContent = 'Error: ' + msg;
    debugEl.style.color = '#ff4a4a';
  });

  sync.connect();

  const homeContainer = document.getElementById('view-home');
  renderHome(homeContainer, {
    async onOpenProject(path) {
      try {
        const { project, filePath } = await sync.loadProject(path);
        if (project) {
          projectManager.load(project, filePath);
          sync.setActiveProject(filePath);
          switchView('gallery');
        }
      } catch (e) {
        console.warn('[workspace] failed to open project:', e.message);
      }
    },
    async onCreateProject(label) {
      try {
        const { project, filePath } = await sync.createProject(label);
        if (project && filePath) {
          projectManager.load(project, filePath);
          sync.setActiveProject(filePath);
          switchView('gallery');
        }
      } catch (e) {
        console.warn('[workspace] failed to create project:', e.message);
      }
    },
  });

  switchView('home');
}

document.addEventListener('DOMContentLoaded', init);

export { state, switchView };
