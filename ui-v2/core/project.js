// project.js — In-memory project state. Syncs with daemon.

let project = null;
let projectId = null;
let comments = [];
let changeListeners = [];

const projectManager = {
  get() { return project; },
  getId() { return projectId; },
  getComments() { return comments; },
  getCommentsForScreen(screenId) { return comments.filter(c => c.screenId === screenId); },

  setFromLoaded(data) {
    project = data.project;
    projectId = data.projectId || projectId;
    comments = data.comments || [];
    this._notify();
  },

  addComment(comment) {
    comments.push(comment);
    this._notify();
  },

  clear() {
    project = null;
    projectId = null;
    comments = [];
    this._notify();
  },

  onChange(fn) { changeListeners.push(fn); },
  offChange(fn) { changeListeners = changeListeners.filter(f => f !== fn); },
  _notify() { for (const fn of changeListeners) fn(); },
};

export default projectManager;
