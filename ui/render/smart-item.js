// Frank — SmartItem classification and rendering
// Classifies "contains" strings and renders them with shadcn-quality HTML.

import { icon, headerIcon } from './icons.js'

// ─── Raw HTML helper ──────────────────────────────────────────────────────────
// Identity function — kept for backwards compatibility.

export function rawHtml(htmlStr) {
  return htmlStr
}

// ─── Classification ───────────────────────────────────────────────────────────

export function classify(raw) {
  const s = raw.toLowerCase()
  if (/·\s*toggle\s+on\b/i.test(s)) return 'toggle-on'
  if (/·\s*toggle\s+off\b/i.test(s)) return 'toggle-off'
  if (/·\s*chevron\b/i.test(s)) return 'row-chevron'
  if (/—\s*destructive\b/i.test(s)) return 'btn-destructive'
  if (/·\s*label\s*$/i.test(s)) return 'stat-label'
  if (/\b(headline|h1|main title|page title|hero title)\b/.test(s)) return 'headline'
  if (/\b(subheadline|subtitle|h2|h3|tagline|description|subtext|supporting)\b/.test(s)) return 'subheadline'
  if (/\b(body|paragraph|copy|body text|text block)\b/.test(s)) return 'body-text'
  if (/\b(primary button|cta|call to action|get started|try free|sign up now|download now)\b/.test(s)) return 'btn-primary'
  if (/\b(button|btn|submit|continue|next|save|confirm|create|sign up|log in|register|send)\b/.test(s)) return 'btn-primary'
  if (/\b(secondary|cancel|back|dismiss|skip|maybe later|no thanks|outline|ghost)\b/.test(s) && /\b(button|btn|action)\b/.test(s)) return 'btn-secondary'
  if (/\b(image|photo|thumbnail|cover|hero image|banner image|illustration|picture|poster)\b/.test(s)) return 'image'
  if (/\b(avatar|profile photo|user photo|profile pic|profile image|user avatar)\b/.test(s)) return 'avatar'
  if (/\b(logo|brand|wordmark)\b/.test(s)) return 'logo'
  if (/\b(icon|symbol)\b/.test(s) && !/\blogo\b/.test(s)) return 'icon'
  if (/\b(input|field|email|password|search|form field|phone|name|first name|last name|address|message|textarea|username)\b/.test(s)) return 'input'
  if (/\b(badge|tag|chip|status|label|pill|count)\b/.test(s)) return 'badge'
  if (/\b(link|nav link|menu item)\b/.test(s)) return 'nav-item'
  return 'text'
}

// ─── Display label (strip type suffixes) ──────────────────────────────────────

export function displayLabel(raw) {
  return raw
    .replace(/\s*—\s*.+$/i, '')
    .replace(/\s*·\s*(toggle\s+on|toggle\s+off|chevron|label)\s*$/i, '')
    .replace(/\s*(primary\s+)?(secondary\s+)?(ghost\s+)?(outline\s+)?button\b/i, '')
    .replace(/\s+\b(headline|subheadline|subtitle|input|icon|image|avatar|logo|badge|link|label)\b/i, '')
    .trim() || raw
}

// ─── Render a single item from contains[] ─────────────────────────────────────

export function smartItem(label) {
  const type = classify(label)
  const text = displayLabel(label)

  switch (type) {
    case 'headline':
      return `<h2 style="font-size:24px;font-weight:600;color:var(--foreground);line-height:1.25;letter-spacing:-0.01em;user-select:none">${text}</h2>`

    case 'subheadline':
      return `<p style="font-size:14px;color:var(--muted-foreground);line-height:1.5;user-select:none">${text}</p>`

    case 'body-text':
      return `<div style="display:flex;flex-direction:column;gap:6px;width:100%">
        <div style="height:8px;background:var(--muted);border-radius:4px;width:100%"></div>
        <div style="height:8px;background:var(--muted);border-radius:4px;width:91%"></div>
        <div style="height:8px;background:var(--muted);border-radius:4px;width:76%"></div>
      </div>`

    case 'btn-primary':
      return `<button class="sc-btn">${text}</button>`

    case 'btn-secondary':
      return `<button class="sc-btn sc-btn--outline">${text}</button>`

    case 'btn-destructive':
      return `<button class="sc-btn sc-btn--destructive">${text}</button>`

    case 'toggle-on':
      return `<div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <span style="font-size:14px;color:var(--foreground);user-select:none">${text}</span>
        <div class="sc-switch sc-switch--on"></div>
      </div>`

    case 'toggle-off':
      return `<div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <span style="font-size:14px;color:var(--foreground);user-select:none">${text}</span>
        <div class="sc-switch"></div>
      </div>`

    case 'row-chevron':
      return `<div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <span style="font-size:14px;color:var(--foreground);user-select:none">${text}</span>
        <span style="color:var(--muted-foreground);flex-shrink:0">${icon('chevron-right', 16)}</span>
      </div>`

    case 'image':
      return `<div class="sc-image-placeholder"></div>`

    case 'avatar':
      return `<div class="sc-avatar">${text.slice(0, 2).toUpperCase() || 'U'}</div>`

    case 'logo':
      return `<span class="sc-header-logo">${text || 'Logo'}</span>`

    case 'icon':
      return `<span class="sc-btn sc-btn--ghost sc-btn--icon">${headerIcon(label)}</span>`

    case 'input':
      return `<div class="sc-field">
        <label class="sc-label">${text}</label>
        <input class="sc-input" placeholder="${text}" readonly>
      </div>`

    case 'stat-label':
      return `<div style="font-size:14px;color:var(--foreground);user-select:none">${text}</div>`

    case 'badge':
      return `<span class="sc-badge">${text}</span>`

    case 'nav-item':
      return `<span class="sc-nav-item">${text}</span>`

    default:
      return `<div style="font-size:14px;color:var(--muted-foreground);user-select:none">${text}</div>`
  }
}
