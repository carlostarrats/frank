import { validateSchema } from './validate.js'
import { renderScreen } from './screen.js'

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  tabs: [],
  activeTabId: null,
  idlePhraseIndex: 0,
  connected: false,
}

// ─── Idle phrases ────────────────────────────────────────────────────────────

const IDLE_PHRASES = ['Watching.', 'Ready.', 'On deck.', 'Listening.', 'Standing by.']

setInterval(() => {
  state.idlePhraseIndex = (state.idlePhraseIndex + 1) % IDLE_PHRASES.length
  const el = document.querySelector('.idle-phrase')
  if (el) el.textContent = IDLE_PHRASES[state.idlePhraseIndex]
}, 5000)

// ─── WebSocket ───────────────────────────────────────────────────────────────

let ws = null
const WS_URL = 'ws://localhost:42069'
const RECONNECT_DELAY = 3000

function connectWs() {
  try { ws = new WebSocket(WS_URL) } catch { setTimeout(connectWs, RECONNECT_DELAY); return }

  ws.onopen = () => { state.connected = true }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'clear') { clearTabs(); render(); return }
      if (msg.type === 'render') {
        const result = validateSchema(msg.schema)
        if (!result.valid) { console.warn('[frank] invalid schema:', result.error); return }

        if (result.schema.type === 'flow') {
          for (const screen of result.schema.screens) {
            addTab({
              schema: 'v1', type: 'screen', label: screen.label,
              timestamp: result.schema.timestamp,
              platform: screen.platform ?? result.schema.platform,
              sections: screen.sections,
            })
          }
        } else {
          addTab(result.schema)
        }
        render()
        if (window.__TAURI__?.core?.invoke) {
          window.__TAURI__.core.invoke('show_panel').catch(() => {})
        }
      }
    } catch { /* ignore malformed */ }
  }

  ws.onclose = () => { ws = null; state.connected = false; setTimeout(connectWs, RECONNECT_DELAY) }
  ws.onerror = () => { ws?.close() }
}

connectWs()

function sendToDaemon(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

// ─── Tab management ──────────────────────────────────────────────────────────

function addTab(schema) {
  const existingIdx = state.tabs.findIndex(t => t.label === schema.label && t.status === 'complete')
  if (existingIdx >= 0) {
    const tab = state.tabs[existingIdx]
    tab.schema = schema
    tab.timestamp = schema.timestamp
    tab.platform = schema.platform
    tab.flashKey++
    state.activeTabId = tab.id
    return tab.id
  }

  const id = crypto.randomUUID()
  state.tabs.push({ id, label: schema.label, timestamp: schema.timestamp, platform: schema.platform, status: 'complete', schema, flashKey: 0 })
  state.activeTabId = id
  return id
}

function closeTab(id) {
  const idx = state.tabs.findIndex(t => t.id === id)
  if (idx === -1) return
  state.tabs.splice(idx, 1)
  if (state.activeTabId === id) {
    state.activeTabId = state.tabs.length ? state.tabs[Math.min(idx, state.tabs.length - 1)].id : null
  }
}

function clearTabs() {
  state.tabs.length = 0
  state.activeTabId = null
}

// ─── Timestamp formatting ────────────────────────────────────────────────────

function formatTimestamp(iso) {
  const date = new Date(iso)
  if (isNaN(date.getTime())) return iso
  const now = new Date()
  const isToday = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// ─── Render ──────────────────────────────────────────────────────────────────

const root = document.getElementById('root')

function render() {
  root.innerHTML = ''

  if (state.tabs.length === 0) {
    root.innerHTML = `
      <div class="panel">
        <div class="idle">
          <span class="idle-wordmark">frank</span>
          <span class="idle-phrase">${IDLE_PHRASES[state.idlePhraseIndex]}</span>
        </div>
      </div>`
    return
  }

  const panel = document.createElement('div')
  panel.className = 'panel'

  // ── Tab bar
  const tabBarWrap = document.createElement('div')
  tabBarWrap.className = 'tab-bar-wrap'
  const tabBar = document.createElement('div')
  tabBar.className = 'tab-bar'

  for (const tab of state.tabs) {
    const btn = document.createElement('button')
    btn.className = 'tab' + (tab.id === state.activeTabId ? ' tab--active' : '')
    btn.title = tab.label
    btn.onclick = () => { state.activeTabId = tab.id; render() }
    btn.onmouseenter = () => { if (tab.id !== state.activeTabId) { btn.style.color = 'var(--text)'; btn.style.background = 'var(--tab-hover-bg)' } }
    btn.onmouseleave = () => { btn.style.color = ''; btn.style.background = '' }
    const span = document.createElement('span')
    span.className = 'tab-label'
    span.textContent = tab.label
    btn.appendChild(span)
    tabBar.appendChild(btn)
  }

  tabBarWrap.appendChild(tabBar)
  panel.appendChild(tabBarWrap)

  // ── Content
  const content = document.createElement('div')
  content.className = 'content'

  const activeTab = state.tabs.find(t => t.id === state.activeTabId)
  if (activeTab) {
    const tabContent = document.createElement('div')
    tabContent.className = 'tab-content'

    // Header
    const header = document.createElement('div')
    header.className = 'tab-content__header'
    header.innerHTML = `
      <span class="tab-content__timestamp">${formatTimestamp(activeTab.timestamp)}</span>
      <div style="display:flex;align-items:center;gap:2px">
        <button class="actions-toggle" title="Edit a section">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        </button>
        <button class="actions-toggle js-actions-btn" title="Export options">
          <span class="actions-toggle__dots" aria-hidden="true"><span></span><span></span><span></span></span>
        </button>
      </div>`

    header.querySelector('.js-actions-btn').onclick = (e) => {
      const rect = e.currentTarget.getBoundingClientRect()
      showActionsMenu(rect, activeTab.id)
    }
    tabContent.appendChild(header)

    // Wireframe placeholder — ArrowJS mounts after DOM attachment
    const wireframe = document.createElement('div')
    wireframe.className = 'tab-content__wireframe'
    wireframe.id = 'wf-mount'
    tabContent.appendChild(wireframe)
    content.appendChild(tabContent)
  }

  panel.appendChild(content)
  root.appendChild(panel)

  // Render wireframe (plain HTML strings now, no ArrowJS)
  const wfMount = document.getElementById('wf-mount')
  if (wfMount && activeTab?.schema) {
    try {
      wfMount.innerHTML = renderScreen(activeTab.schema)
    } catch (err) {
      wfMount.innerHTML = `<div style="padding:16px;color:#c00;font-size:11px;font-family:monospace;word-break:break-all;background:#fff0f0"><strong>Render error:</strong> ${err.message}</div>`
    }
  }
}

function showActionsMenu(btnRect, tabId) {
  document.querySelector('.actions-menu-overlay')?.remove()
  document.querySelector('.actions-menu')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'actions-menu-overlay'
  overlay.onclick = () => { overlay.remove(); menu.remove() }

  const menu = document.createElement('div')
  menu.className = 'actions-menu'
  menu.style.top = (btnRect.bottom + 4) + 'px'
  menu.style.right = (window.innerWidth - btnRect.right) + 'px'

  const items = [
    { label: 'Copy Markdown', action: () => flash('Coming soon') },
    { label: 'Save .md', action: () => flash('Coming soon') },
    'sep',
    { label: 'Save PNG', action: () => flash('Coming soon') },
    'sep',
    { label: 'Close tab', action: () => { closeTab(tabId); render() }, cls: 'actions-menu__item--destructive' },
  ]

  for (const item of items) {
    if (item === 'sep') {
      const sep = document.createElement('div')
      sep.className = 'actions-menu__separator'
      menu.appendChild(sep)
    } else {
      const btn = document.createElement('button')
      btn.className = 'actions-menu__item' + (item.cls ? ' ' + item.cls : '')
      btn.textContent = item.label
      btn.onclick = () => { overlay.remove(); menu.remove(); item.action() }
      menu.appendChild(btn)
    }
  }

  document.body.appendChild(overlay)
  document.body.appendChild(menu)
}

function flash(label) {
  const btn = document.querySelector('.js-actions-btn')
  if (btn) {
    btn.innerHTML = `<span class="actions-toggle__confirmed">${label}</span>`
    setTimeout(() => {
      btn.innerHTML = '<span class="actions-toggle__dots" aria-hidden="true"><span></span><span></span><span></span></span>'
    }, 2000)
  }
}

// ── Initial render
render()

// ── Test mode: load sample wireframe if ?test is in the URL
if (location.search.includes('test')) {
  const demo = {
    schema: 'v1', type: 'screen', label: 'Dashboard',
    timestamp: new Date().toISOString(), platform: 'web',
    sections: [
      { type: 'header', contains: ['Acme logo wordmark', 'Dashboard nav link', 'Reports nav link', 'Settings nav link', 'Search input', 'Notifications icon button', 'User avatar'] },
      { type: 'stats-row', contains: ['Total Revenue stat card — $84,320 value — +12.4% badge', 'Orders stat card — 1,284 value — +8.1% badge', 'Customers stat card — 3,429 value — +4.2% badge'] },
      { type: 'chart', label: 'Revenue Over Time', contains: ['Revenue vs Orders line chart — Jan, Feb, Mar, Apr, May, Jun axis labels', 'Revenue line — blue', 'Orders line — gray', '30 Day selector tab active', '90 Day selector tab', '12 Month selector tab'] },
      { type: 'list', label: 'Recent Orders', contains: ['Order # column header', 'Customer column header', 'Amount column header', 'Status column header', '#ORD-001 — Sarah Johnson — $245.00 — Fulfilled badge', '#ORD-002 — Mike Chen — $189.50 — Pending badge', '#ORD-003 — Lisa Park — $320.00 — Shipped badge', 'Previous button', 'Page 1 of 12', 'Next button'] }
    ]
  }
  addTab(demo)
  render()
}

// ── Debug hooks
window._frankState = state
window._frankRender = render
window._frankAddTab = (schema) => { addTab(schema); render() }
