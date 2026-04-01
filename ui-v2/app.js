// app.js — App shell: view router, state management
import sync from './core/sync.js';
import projectManager from './core/project.js';
import { renderHome } from './views/home.js';
import { renderViewer } from './views/viewer.js';
import { renderTimeline } from './views/timeline.js';
import { setupAiRouting } from './components/ai-routing.js';

const state = {
  currentView: 'home',
};

function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  state.currentView = view;

  if (view === 'home') {
    renderHome(document.getElementById('view-home'), {
      onOpenProject(projectId) {
        sync.loadProject(projectId).then(data => {
          projectManager.setFromLoaded({ ...data, projectId });
          switchView('viewer');
        });
      },
      onCreateProject(name, contentType, url) {
        sync.createProject(name, contentType, url).then(data => {
          projectManager.setFromLoaded(data);
          switchView('viewer');
        });
      },
    });
  }

  if (view === 'viewer') {
    renderViewer(document.getElementById('view-viewer'), {
      onBack() {
        projectManager.clear();
        switchView('home');
      },
    });
  }

  if (view === 'timeline') {
    renderTimeline(document.getElementById('view-timeline'), {
      onBack() { switchView('viewer'); },
    });
  }
}

window.addEventListener('frank:open-timeline', () => {
  if (projectManager.get()) switchView('timeline');
});

// Listen for pushed messages from daemon
sync.onMessage((msg) => {
  if (msg.type === 'comment-added') {
    projectManager.addComment(msg.comment);
  }
});

// Boot
sync.connect();
setupAiRouting();
setTimeout(() => switchView('home'), 100);
