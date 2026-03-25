// workspace.js — App shell: view router, state management

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
  switchView('home');
}

document.addEventListener('DOMContentLoaded', init);

export { state, switchView };
