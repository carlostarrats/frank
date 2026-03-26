// project.js — In-memory project state. Does NOT perform file I/O.
// All saves go through sync.js → daemon.

import sync from './sync.js';

let project = null;
let filePath = null;
let onChange = null;

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateScreenId(label, existingIds) {
  let id = slugify(label);
  if (!existingIds.includes(id)) return id;
  let n = 2;
  while (existingIds.includes(`${id}-${n}`)) n++;
  return `${id}-${n}`;
}

const projectManager = {
  get() { return project; },
  getFilePath() { return filePath; },

  load(data, path) {
    project = data;
    filePath = path;
    if (onChange) onChange(project);
  },

  setOnChange(cb) { onChange = cb; },

  async save() {
    if (!project || !filePath) return;
    project.savedAt = new Date().toISOString();
    // Validate screenOrder matches screens keys
    const screenKeys = Object.keys(project.screens || {});
    project.screenOrder = (project.screenOrder || []).filter(id => screenKeys.includes(id));
    for (const key of screenKeys) {
      if (!project.screenOrder.includes(key)) project.screenOrder.push(key);
    }
    project._filePath = filePath;
    try {
      await sync.saveProject(project);
    } catch (e) {
      console.warn('[project] save failed:', e.message);
    }
    if (onChange) onChange(project);
  },

  // All mutation methods update memory synchronously, then save async.
  // Save errors are logged but don't block — next mutation retries.

  addScreen(screen) {
    if (!project) return null;
    const id = generateScreenId(screen.label || 'Untitled', Object.keys(project.screens || {}));
    project.screens = project.screens || {};
    project.screens[id] = { ...screen };
    project.screenOrder = project.screenOrder || [];
    project.screenOrder.push(id);
    this.save();
    return id;
  },

  updateScreen(id, updates) {
    if (!project?.screens?.[id]) return;
    project.screens[id] = { ...project.screens[id], ...updates };
    this.save();
  },

  deleteScreen(id) {
    if (!project?.screens?.[id]) return;
    delete project.screens[id];
    project.screenOrder = (project.screenOrder || []).filter(sid => sid !== id);
    this.save();
  },

  duplicateScreen(id, newLabel) {
    if (!project?.screens?.[id]) return null;
    const original = project.screens[id];
    const newScreen = JSON.parse(JSON.stringify(original));
    newScreen.label = newLabel;
    newScreen.notes = [];
    newScreen.stars = [];
    return this.addScreen(newScreen);
  },

  reorderScreens(newOrder) {
    if (!project) return;
    project.screenOrder = newOrder;
    this.save();
  },

  getScreen(id) {
    return project?.screens?.[id] || null;
  },

  getScreenOrder() {
    return project?.screenOrder || [];
  },

  getAllScreens() {
    if (!project) return [];
    return (project.screenOrder || []).map(id => ({
      id,
      ...project.screens[id],
    })).filter(s => s.sections);
  },

  updateActiveShare(share) {
    if (!project) return;
    project.activeShare = share;
    this.save();
  },

  getActiveShare() {
    return project?.activeShare || null;
  },
};

export default projectManager;
