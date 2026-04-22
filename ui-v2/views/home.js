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

const SORT_LABELS = {
  recent: 'Recent',
  oldest: 'Oldest',
  alpha: 'A–Z',
  type: 'Type',
};

const FILTER_LABELS = {
  all: 'All',
  canvas: 'Canvas',
  url: 'URL',
  pdf: 'PDF',
  image: 'Image',
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
        <a class="home-icon-btn" id="home-github-btn" href="https://github.com/carlostarrats/frank" target="_blank" rel="noopener noreferrer" title="Frank on GitHub" aria-label="GitHub">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.73.5.67 5.56.67 11.83c0 5.02 3.26 9.27 7.77 10.77.57.1.78-.25.78-.55v-1.93c-3.16.69-3.83-1.52-3.83-1.52-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.73 2.65 1.23 3.3.94.1-.73.4-1.23.72-1.51-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.05-.12-.29-.51-1.44.11-3 0 0 .95-.3 3.12 1.16a10.8 10.8 0 0 1 5.68 0c2.17-1.46 3.12-1.16 3.12-1.16.62 1.56.23 2.71.11 3 .73.8 1.17 1.81 1.17 3.05 0 4.35-2.66 5.31-5.19 5.59.41.35.77 1.04.77 2.1v3.11c0 .3.21.66.79.55 4.51-1.5 7.76-5.75 7.76-10.77C23.33 5.56 18.27.5 12 .5z"/></svg>
          <span>GitHub</span>
        </a>
      </header>

      <div class="home-grid">
        <div class="home-col home-col-left">
          <section class="home-panel" data-title="about">
            <h1 class="home-headline">A free local-first collaboration layer.</h1>
            <p class="home-lede">Runs on your machine. Point Frank at a URL, drop in a file, or start a canvas — then comment, curate, and route feedback to AI. Every decision captured. Frank is private: we don't collect your data and never see your projects. Anything you do share goes through your own cloud backend to whoever you send the link to.</p>
          </section>

          <section class="home-panel" data-title="new share">
            <div class="home-new" id="home-new"></div>
          </section>

          <section class="home-panel" data-title="canvas">
            <p class="home-panel-lede">Start with a blank infinite canvas. Sketch, diagram, drop images, or brainstorm — then share it live with reviewers.</p>
            <button class="btn-secondary home-canvas-btn" id="new-canvas-btn">+ New canvas</button>
          </section>

          <p class="home-mcp">
            Connect Claude, Cursor, or any MCP-capable AI to Frank — <a href="#" class="home-mcp-link" id="home-mcp-link">setup instructions</a>
          </p>
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

  // The "setup instructions" link under the Canvas panel deep-links to the
  // MCP Setup top-level tab inside the Settings modal — the actual config
  // JSON + per-client paths live there so they can scroll freely instead
  // of expanding on the home layout.
  container.querySelector('#home-mcp-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    showSettingsPanel({ initialTopTab: 'mcp' });
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
    const isActive = uiState.tab === id;
    const active = isActive ? ' active' : '';
    return `<button class="home-tab${active}" data-tab="${id}" role="tab" aria-selected="${isActive}" aria-controls="list-current">${label}<span class="home-tab-count">${count}</span></button>`;
  };
  return `
    <div class="home-tabs" role="tablist" aria-label="Project lists">
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
  const countFor = (id) => id === 'all' ? activeProjects.length : (typeCounts[id] || 0);

  const caret = `<svg class="home-sort-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  return `
    <div class="home-toolbar">
      <input
        type="search"
        class="input home-search"
        placeholder="Search projects…"
        aria-label="Search projects"
        value="${escapeHtml(uiState.search)}"
        id="home-search-input"
      >
      <div class="home-filter-row">
        <div class="home-sort-wrapper">
          <button type="button" class="btn-secondary home-sort-btn" id="home-filter-btn" aria-haspopup="menu" aria-expanded="false" title="Kind">
            <span class="home-sort-label">${FILTER_LABELS[uiState.filter]} <span class="chip-count">${countFor(uiState.filter)}</span></span>
            ${caret}
          </button>
          <div class="home-sort-menu" id="home-filter-menu" role="menu" hidden>
            ${['all', 'canvas', 'url', 'pdf', 'image'].map(k => `
              <button type="button" role="menuitemradio" aria-checked="${uiState.filter === k}" class="home-sort-item${uiState.filter === k ? ' active' : ''}" data-filter="${k}">${FILTER_LABELS[k]} <span class="chip-count">${countFor(k)}</span></button>
            `).join('')}
          </div>
        </div>
        <div class="home-sort-wrapper">
          <button type="button" class="btn-secondary home-sort-btn" id="home-sort-btn" aria-haspopup="menu" aria-expanded="false" title="Sort">
            <span class="home-sort-label">${SORT_LABELS[uiState.sort] || 'Sort'}</span>
            ${caret}
          </button>
          <div class="home-sort-menu" id="home-sort-menu" role="menu" hidden>
            ${['recent', 'oldest', 'alpha', 'type'].map(k => `
              <button type="button" role="menuitemradio" aria-checked="${uiState.sort === k}" class="home-sort-item${uiState.sort === k ? ' active' : ''}" data-sort="${k}">${SORT_LABELS[k]}</button>
            `).join('')}
          </div>
        </div>
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

  wireDropdown(host, '#home-sort-btn', '#home-sort-menu', 'sort', refresh);
  wireDropdown(host, '#home-filter-btn', '#home-filter-menu', 'filter', refresh);
}

// Shared wiring for the Kind + Sort dropdowns: toggle, click-outside,
// Escape, fixed-positioning anchor relative to the trigger button.
function wireDropdown(host, btnSel, menuSel, stateKey, refresh) {
  const btn = host.querySelector(btnSel);
  const menu = host.querySelector(menuSel);
  if (!btn || !menu) return;
  const itemSel = `data-${stateKey}`;

  const close = () => {
    menu.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu.hasAttribute('hidden')) { close(); return; }
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.right - menu.offsetWidth || rect.right - 140}px`;
    menu.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    // Re-anchor after layout so offsetWidth is known.
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, rect.right - w)}px`;
  });
  menu.querySelectorAll('.home-sort-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      uiState[stateKey] = item.getAttribute(itemSel);
      close();
      refresh();
    });
  });
  document.addEventListener('click', (e) => {
    if (menu.hasAttribute('hidden')) return;
    if (e.target.closest('.home-sort-wrapper')) return;
    close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hasAttribute('hidden')) close();
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
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.map(it => `
    <button class="project-menu-item ${it.danger ? 'project-menu-item-danger' : ''}" data-key="${it.key}" role="menuitem">
      ${it.label}
    </button>
  `).join('');

  // Place off-screen first so we can measure the real menu size, then clamp
  // it into the viewport (flip above the button if it would fall off the
  // bottom). Fixes the case where a card near the bottom of the list hides
  // the menu below the fold.
  menu.style.top = '-9999px';
  menu.style.left = '-9999px';
  document.body.appendChild(menu);
  openMenu = menu;

  const rect = anchorBtn.getBoundingClientRect();
  const gap = 4;
  const pad = 8;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;

  const wouldOverflowBottom = rect.bottom + gap + mh > window.innerHeight - pad;
  const top = wouldOverflowBottom
    ? Math.max(pad, rect.top - gap - mh)
    : rect.bottom + gap;

  const desiredLeft = rect.right - mw;
  const left = Math.max(pad, Math.min(desiredLeft, window.innerWidth - mw - pad));

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

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
