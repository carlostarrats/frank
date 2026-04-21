// home.js — Project list: create, rename, archive, trash, restore, search/sort/filter.

import sync from '../core/sync.js';
import { renderUrlInput } from '../components/url-input.js';
import { showHelpPanel } from '../components/help-panel.js';
import { showSettingsPanel } from '../components/settings-panel.js';

const DEFAULT_UI_STATE = {
  search: '',
  sort: 'recent',           // 'recent' | 'oldest' | 'alpha' | 'type'
  filter: 'all',            // 'all' | 'canvas' | 'url' | 'pdf' | 'image'
  tab: 'recent',            // 'recent' | 'archived' | 'trash'
};

let uiState = { ...DEFAULT_UI_STATE };
let openMenu = null;

export function renderHome(container, { onOpenProject, onCreateProject }) {
  container.innerHTML = `
    <div class="home">
      <header class="home-masthead">
        <img src="frank-logo.svg" alt="Frank" class="home-logo">
        <span class="home-version">v3.0</span>
        <div class="home-masthead-spacer"></div>
        <button class="home-icon-btn" id="home-settings-btn" title="Settings" aria-label="Settings">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>Settings</span>
        </button>
        <button class="home-icon-btn" id="home-help-btn" title="Getting started" aria-label="Help">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>Help</span>
        </button>
      </header>

      <div class="home-grid">
        <div class="home-col home-col-left">
          <div class="home-new" id="home-new"></div>

          <div class="home-new-canvas" id="home-new-canvas">
            <button class="btn-secondary home-canvas-btn" id="new-canvas-btn">+ New canvas</button>
          </div>
        </div>

        <div class="home-col home-col-right">
          <div class="home-projects" id="home-projects">
            <div class="project-list-loading">Loading…</div>
          </div>
        </div>
      </div>
    </div>
  `;

  renderUrlInput(container.querySelector('#home-new'), {
    onSubmit(name, contentType, url) {
      onCreateProject(name, contentType, url);
    },
    onFileSubmit(name, contentType, fileName, data) {
      onCreateProject(name, contentType, undefined, undefined, { fileName, data });
    },
  });

  container.querySelector('#new-canvas-btn').addEventListener('click', () => {
    const name = prompt('Canvas name:', 'Untitled Canvas');
    if (name === null) return;
    const trimmed = name.trim() || 'Untitled Canvas';
    onCreateProject(trimmed, 'canvas', undefined);
  });

  container.querySelector('#home-settings-btn').addEventListener('click', () => {
    showSettingsPanel();
  });

  container.querySelector('#home-help-btn').addEventListener('click', () => {
    showHelpPanel({
      onFocusUrlInput() {
        const field = container.querySelector('#url-field');
        if (field) { field.focus(); field.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      },
      onCreateCanvas() {
        onCreateProject('Untitled Canvas', 'canvas', undefined);
      },
    });
  });

  const refresh = () => {
    sync.listProjects().then(data => {
      renderProjects(container.querySelector('#home-projects'), data.projects || [], {
        onOpenProject,
        refresh,
      });
    });
  };
  refresh();

  // Click-outside closes any open context menu.
  document.addEventListener('click', closeOpenMenu, { capture: true });
}

function closeOpenMenu(e) {
  if (!openMenu) return;
  if (e && (openMenu.contains(e.target) || e.target.closest('.project-menu-btn'))) return;
  openMenu.remove();
  openMenu = null;
}

function renderProjects(host, projects, { onOpenProject, refresh }) {
  const active = projects.filter(p => !p.archived && !p.trashed);
  const archived = projects.filter(p => p.archived && !p.trashed);
  const trashed = projects.filter(p => p.trashed);

  if (projects.length === 0) {
    host.innerHTML = `
      <h3 class="home-section-title">Recent projects</h3>
      <div class="project-list">
        <p class="project-list-empty">No projects yet</p>
      </div>
    `;
    return;
  }


  const variant = uiState.tab;
  const list = variant === 'archived' ? archived : variant === 'trash' ? trashed : active;

  const trashNotice = variant === 'trash'
    ? `<p class="home-trash-notice">Deleted projects stay here for 30 days, then are permanently removed.</p>`
    : '';

  host.innerHTML = `
    ${renderTabs(active.length, archived.length, trashed.length)}
    <div class="home-section">
      ${trashNotice}
      ${renderToolbar(list)}
      <div class="project-list${variant === 'trash' ? ' project-list-trash' : ''}" id="list-current"></div>
    </div>
  `;

  wireToolbar(host, refresh);
  wireTabs(host, refresh);

  const filtered = applyFilters(list, uiState);
  const listEl = host.querySelector('#list-current');
  if (filtered.length === 0) {
    const isFiltering = uiState.search.trim() !== '' || uiState.filter !== 'all';
    const message = isFiltering ? 'No projects match' : 'None';
    listEl.innerHTML = `<p class="project-list-empty">${message}</p>`;
  } else {
    const cardVariant = variant === 'archived' ? 'archived' : variant === 'trash' ? 'trash' : 'active';
    listEl.innerHTML = filtered.map(p => renderCard(p, cardVariant)).join('');
    wireCards(listEl, filtered, cardVariant, { onOpenProject, refresh });
  }
}

function renderTabs(recentCount, archivedCount, trashedCount) {
  const tab = (id, label, count) => {
    const active = uiState.tab === id ? ' active' : '';
    return `<button class="home-tab${active}" data-tab="${id}">${label}<span class="home-tab-count">${count}</span></button>`;
  };
  return `
    <div class="home-tabs" role="tablist">
      ${tab('recent', 'Recent', recentCount)}
      ${tab('archived', 'Archived', archivedCount)}
      ${tab('trash', 'Deleted', trashedCount)}
    </div>
  `;
}

function wireTabs(host, refresh) {
  host.querySelectorAll('.home-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.tab = btn.dataset.tab;
      refresh();
    });
  });
}

// ─── Toolbar (search / sort / filter) ───────────────────────────────────────

function renderToolbar(activeProjects) {
  const typeCounts = activeProjects.reduce((acc, p) => {
    acc[p.contentType] = (acc[p.contentType] || 0) + 1;
    return acc;
  }, {});
  const chip = (id, label) => {
    const count = id === 'all' ? activeProjects.length : (typeCounts[id] || 0);
    const active = uiState.filter === id ? ' active' : '';
    return `<button class="chip${active}" data-filter="${id}">${label}<span class="chip-count">${count}</span></button>`;
  };

  return `
    <div class="home-toolbar">
      <input
        type="search"
        class="input home-search"
        placeholder="Search projects…"
        value="${escapeHtml(uiState.search)}"
        id="home-search-input"
      >
      <div class="home-filter-row">
        ${chip('all', 'All')}
        ${chip('canvas', 'Canvas')}
        ${chip('url', 'URL')}
        ${chip('pdf', 'PDF')}
        ${chip('image', 'Image')}
        <select class="input home-sort" id="home-sort-select" title="Sort">
          <option value="recent"${uiState.sort === 'recent' ? ' selected' : ''}>Recent</option>
          <option value="oldest"${uiState.sort === 'oldest' ? ' selected' : ''}>Oldest</option>
          <option value="alpha"${uiState.sort === 'alpha' ? ' selected' : ''}>A–Z</option>
          <option value="type"${uiState.sort === 'type' ? ' selected' : ''}>Type</option>
        </select>
      </div>
    </div>
  `;
}

function wireToolbar(host, refresh) {
  const search = host.querySelector('#home-search-input');
  if (search) {
    let debounce = null;
    search.addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        uiState.search = e.target.value;
        refresh();
      }, 150);
    });
  }

  const sort = host.querySelector('#home-sort-select');
  if (sort) {
    sort.addEventListener('change', (e) => {
      uiState.sort = e.target.value;
      refresh();
    });
  }

  host.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      uiState.filter = btn.dataset.filter;
      refresh();
    });
  });
}

function applyFilters(projects, state) {
  let list = projects.slice();

  if (state.filter !== 'all') {
    list = list.filter(p => p.contentType === state.filter);
  }

  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter(p => p.name.toLowerCase().includes(q));
  }

  const sortFn = {
    recent:  (a, b) => b.modified.localeCompare(a.modified),
    oldest:  (a, b) => a.modified.localeCompare(b.modified),
    alpha:   (a, b) => a.name.localeCompare(b.name),
    type:    (a, b) => a.contentType.localeCompare(b.contentType) || b.modified.localeCompare(a.modified),
  }[state.sort] || ((a, b) => 0);
  list.sort(sortFn);

  return list;
}

// ─── Card render + wiring ───────────────────────────────────────────────────

function renderCard(p, variant) {
  const classes = ['project-card'];
  if (variant !== 'active') classes.push(`project-card-${variant}`);
  const meta = variant === 'trash' && p.trashed
    ? `${p.contentType} · Deleted ${timeAgo(p.trashed)} · Auto-removes in ${daysUntilPurge(p.trashed)}d`
    : `${p.contentType} · ${p.commentCount} comments · ${timeAgo(p.modified)}`;
  // role/tabindex so the card is focusable; screen readers announce it as a
  // button-like row with the project name.
  const accessibleLabel = variant === 'trash'
    ? `${p.name}, trashed — press Enter to focus, arrow keys to navigate`
    : `${p.name} — press Enter to open, F2 to rename, Delete to move to trash`;
  return `
    <div class="${classes.join(' ')}"
         data-id="${p.projectId}"
         data-variant="${variant}"
         role="button"
         tabindex="0"
         aria-label="${escapeHtml(accessibleLabel)}">
      <div class="project-card-info">
        <span class="project-card-name" data-id="${p.projectId}">${escapeHtml(p.name)}</span>
        <span class="project-card-meta">${escapeHtml(meta)}</span>
      </div>
      <div class="project-card-actions">
        <button class="btn-ghost project-menu-btn" data-id="${p.projectId}" title="More actions" aria-label="More actions for ${escapeHtml(p.name)}">⋯</button>
      </div>
    </div>
  `;
}

function wireCards(host, projects, variant, { onOpenProject, refresh }) {
  const cards = Array.from(host.querySelectorAll('.project-card'));

  cards.forEach((card, idx) => {
    const id = card.dataset.id;
    const project = projects.find(p => p.projectId === id);

    // Open on click (active + archived only; trash requires restore first).
    card.addEventListener('click', (e) => {
      if (e.target.closest('.project-menu-btn')) return;
      if (e.target.closest('.project-card-name[contenteditable]')) return;
      if (e.target.closest('.project-menu')) return;
      if (variant === 'trash') return;
      onOpenProject(id);
    });

    // Keyboard navigation:
    //   Enter / Space  — open the project (active + archived)
    //   F2             — start inline rename
    //   Delete / Bksp  — trash (active + archived) or purge (trash)
    //   ↑ / ↓          — move focus between adjacent cards
    card.addEventListener('keydown', (e) => {
      // Don't hijack keys while the user is editing the name.
      if (card.querySelector('.project-card-name[contenteditable]')) return;

      if (e.key === 'Enter' || e.key === ' ') {
        if (variant === 'trash') return;
        e.preventDefault();
        onOpenProject(id);
        return;
      }
      if (e.key === 'F2' && variant !== 'trash') {
        e.preventDefault();
        const nameEl = card.querySelector('.project-card-name');
        startRename(nameEl, project, refresh);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (variant === 'trash') {
          if (confirm(`Delete "${project.name}" permanently? This cannot be undone.`)) {
            sync.purgeProject(id).then(refresh);
          }
        } else {
          confirmTrash(project, refresh);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = cards[idx + 1] || cards[0];
        next?.focus();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = cards[idx - 1] || cards[cards.length - 1];
        prev?.focus();
      }
    });

    // Inline rename on name click (active + archived). Mouse-only entry
    // point — the keyboard path uses F2 above.
    const nameEl = card.querySelector('.project-card-name');
    if (variant !== 'trash') {
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        startRename(nameEl, project, refresh);
      });
    }

    // Context menu.
    const menuBtn = card.querySelector('.project-menu-btn');
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCardMenu(menuBtn, project, variant, refresh);
    });
  });
}

function startRename(nameEl, project, refresh) {
  if (nameEl.dataset.editing === '1') return;
  nameEl.dataset.editing = '1';
  const original = project.name;
  nameEl.setAttribute('contenteditable', 'plaintext-only');
  nameEl.classList.add('editing');
  nameEl.focus();
  // Select all text.
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = (commit) => {
    nameEl.removeAttribute('contenteditable');
    nameEl.classList.remove('editing');
    delete nameEl.dataset.editing;
    const trimmed = nameEl.textContent.trim();
    if (commit && trimmed && trimmed !== original) {
      sync.renameProject(project.projectId, trimmed).then(refresh);
    } else {
      nameEl.textContent = original;
    }
  };

  nameEl.addEventListener('blur', () => finish(true), { once: true });
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); nameEl.textContent = original; nameEl.blur(); }
  });
}

// ─── Context menu popover ───────────────────────────────────────────────────

function openCardMenu(anchorBtn, project, variant, refresh) {
  closeOpenMenu();

  const items = menuItemsForVariant(project, variant, refresh);
  const menu = document.createElement('div');
  menu.className = 'project-menu';
  menu.innerHTML = items.map(it => `
    <button class="project-menu-item ${it.danger ? 'project-menu-item-danger' : ''}" data-key="${it.key}">
      ${it.label}
    </button>
  `).join('');

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.right - 180)}px`;
  document.body.appendChild(menu);
  openMenu = menu;

  menu.querySelectorAll('.project-menu-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const item = items.find(i => i.key === key);
      if (item) item.action();
      menu.remove();
      openMenu = null;
    });
  });
}

function menuItemsForVariant(project, variant, refresh) {
  if (variant === 'trash') {
    return [
      { key: 'restore', label: 'Restore', action: () => sync.restoreProject(project.projectId).then(refresh) },
      { key: 'purge', label: 'Delete permanently', danger: true, action: () => {
        if (confirm(`Delete "${project.name}" permanently? This cannot be undone.`)) {
          sync.purgeProject(project.projectId).then(refresh);
        }
      }},
    ];
  }
  if (variant === 'archived') {
    return [
      { key: 'rename', label: 'Rename', action: () => {
        const card = document.querySelector(`.project-card[data-id="${project.projectId}"] .project-card-name`);
        if (card) startRename(card, project, refresh);
      }},
      { key: 'unarchive', label: 'Unarchive', action: () => sync.unarchiveProject(project.projectId).then(refresh) },
      { key: 'trash', label: 'Delete', danger: true, action: () => confirmTrash(project, refresh) },
    ];
  }
  return [
    { key: 'rename', label: 'Rename', action: () => {
      const card = document.querySelector(`.project-card[data-id="${project.projectId}"] .project-card-name`);
      if (card) startRename(card, project, refresh);
    }},
    { key: 'archive', label: 'Archive', action: () => sync.archiveProject(project.projectId).then(refresh) },
    { key: 'trash', label: 'Delete', danger: true, action: () => confirmTrash(project, refresh) },
  ];
}

function confirmTrash(project, refresh) {
  if (confirm(`Delete "${project.name}"? It will move to Trash for 30 days.`)) {
    sync.trashProject(project.projectId).then(refresh);
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

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

function daysUntilPurge(trashedIso) {
  const trashedAt = new Date(trashedIso).getTime();
  const retentionMs = 30 * 24 * 60 * 60 * 1000;
  const remaining = trashedAt + retentionMs - Date.now();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}
