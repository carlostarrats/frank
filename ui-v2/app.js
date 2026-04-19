// app.js — App shell: view router, state management
import sync from './core/sync.js';
import projectManager from './core/project.js';
import { renderHome } from './views/home.js';
import { renderViewer } from './views/viewer.js';
import { renderTimeline } from './views/timeline.js';
import { renderCanvas } from './views/canvas.js';
import { setupAiRouting } from './components/ai-routing.js';
import { toastError } from './components/toast.js';

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
      onCreateProject(name, contentType, url, _file, fileUpload) {
        const create = fileUpload
          ? sync.createProjectFromFile(name, contentType, fileUpload.fileName, fileUpload.data)
          : sync.createProject(name, contentType, url);
        create.then(data => {
          if (data.type === 'error') {
            toastError(`Could not create project: ${data.error}`);
            return;
          }
          projectManager.setFromLoaded(data);
          switchView(viewForProject(data.project));
        }).catch((err) => {
          toastError(`Could not create project: ${err.message || err}`);
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
      onBack() {
        // Return to whichever view this project came from — canvas or viewer.
        const project = projectManager.get();
        switchView(project ? viewForProject(project) : 'home');
      },
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
  } else if (msg.type === 'project-loaded' && msg.comments) {
    // Daemon broadcasts this after curate / delete / remix actions. Keep the
    // in-memory comment list in sync so status changes show in the UI.
    projectManager.setFromLoaded(msg);
  }
});

// Boot
sync.connect();
setupAiRouting();
setTimeout(() => switchView('home'), 100);
