// app.js — App shell: view router, state management
import sync from './core/sync.js';
import projectManager from './core/project.js';
import { renderHome } from './views/home.js';
import { renderViewer } from './views/viewer.js';
import { renderTimeline } from './views/timeline.js';
import { renderCanvas } from './views/canvas.js';
import { renderScaffold } from './views/scaffold.js';
import { setupAiRouting } from './components/ai-routing.js';

const state = {
  currentView: 'home',
};

function viewForProject(project) {
  return project?.contentType === 'canvas' ? 'canvas' : 'viewer';
}

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
          switchView(viewForProject(data.project));
        });
      },
      onCreateProject(name, contentType, url) {
        sync.createProject(name, contentType, url).then(data => {
          projectManager.setFromLoaded(data);
          switchView(viewForProject(data.project));
        });
      },
      onScaffold() { switchView('scaffold'); },
    });
  }

  if (view === 'scaffold') {
    renderScaffold(document.getElementById('view-scaffold'), {
      onBack() { switchView('home'); },
      onScaffoldReady() { switchView('viewer'); },
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

  if (view === 'canvas') {
    renderCanvas(document.getElementById('view-canvas'), {
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
