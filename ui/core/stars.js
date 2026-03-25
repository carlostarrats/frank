// stars.js — Snapshot management. Stars are permanent, stored in the project file.

import projectManager from './project.js';
import undoManager from './undo.js';

const starsManager = {
  star(screenId, label) {
    const screen = projectManager.getScreen(screenId);
    if (!screen) return;
    const stars = [...(screen.stars || [])];
    stars.push({
      label: label || `Star ${stars.length + 1}`,
      ts: new Date().toISOString(),
      sections: JSON.parse(JSON.stringify(screen.sections)),
    });
    projectManager.updateScreen(screenId, { stars });
  },

  restore(screenId, starIndex) {
    const screen = projectManager.getScreen(screenId);
    if (!screen?.stars?.[starIndex]) return null;
    undoManager.push(screenId, screen.sections);
    const restored = JSON.parse(JSON.stringify(screen.stars[starIndex].sections));
    projectManager.updateScreen(screenId, { sections: restored });
    return restored;
  },

  list(screenId) {
    const screen = projectManager.getScreen(screenId);
    return screen?.stars || [];
  },

  remove(screenId, starIndex) {
    const screen = projectManager.getScreen(screenId);
    if (!screen?.stars?.[starIndex]) return;
    const stars = [...screen.stars];
    stars.splice(starIndex, 1);
    projectManager.updateScreen(screenId, { stars });
  },

  count(screenId) {
    return projectManager.getScreen(screenId)?.stars?.length || 0;
  },
};

export default starsManager;
