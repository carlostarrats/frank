// Frank — SmartItem classification and rendering
// Ports the SmartItem system from WireframeSection.tsx to plain JS + HTML string templates.

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
      return `<p class="text-2xl font-bold text-foreground leading-tight select-none">${text}</p>`

    case 'subheadline':
      return `<p class="text-base text-muted-foreground leading-snug select-none">${text}</p>`

    case 'body-text':
      return `<div class="flex flex-col gap-1 w-full">
        <div style="height:8px;background:var(--wf-border);border-radius:2px;width:100%"></div>
        <div style="height:8px;background:var(--wf-border);border-radius:2px;width:91%"></div>
        <div style="height:8px;background:var(--wf-border);border-radius:2px;width:76%"></div>
      </div>`

    case 'btn-primary':
      return `<button class="wf-btn">${text}</button>`

    case 'btn-secondary':
      return `<button class="wf-btn wf-btn--outline">${text}</button>`

    case 'btn-destructive':
      return `<button class="wf-btn wf-btn--outline">${text}</button>`

    case 'toggle-on':
      return `<div class="flex items-center justify-between w-full">
        <span class="text-sm text-foreground select-none">${text}</span>
        <div class="wf-switch wf-switch--on"></div>
      </div>`

    case 'toggle-off':
      return `<div class="flex items-center justify-between w-full">
        <span class="text-sm text-foreground select-none">${text}</span>
        <div class="wf-switch"></div>
      </div>`

    case 'row-chevron':
      return `<div class="flex items-center justify-between w-full">
        <span class="text-sm text-foreground select-none">${text}</span>
        <span class="text-muted-foreground flex-shrink-0">${icon('chevron-right', 16)}</span>
      </div>`

    case 'image':
      return `<div class="wf-image-placeholder"></div>`

    case 'avatar':
      return `<div class="wf-avatar">${text.slice(0, 2).toUpperCase() || 'U'}</div>`

    case 'logo':
      return `<span style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--wf-text);background:var(--wf-muted);border:1px solid var(--wf-border);border-radius:4px;padding:2px 8px;user-select:none">LOGO</span>`

    case 'icon':
      return `<span class="wf-btn wf-btn--ghost wf-btn--icon">${headerIcon(label)}</span>`

    case 'input':
      return `<div class="flex flex-col gap-1 w-full">
        <label class="wf-label">${text}</label>
        <input class="wf-input" placeholder="${text}" readonly>
      </div>`

    case 'stat-label':
      return `<div class="text-sm text-foreground select-none">${text}</div>`

    case 'badge':
      return `<span class="wf-badge">${text}</span>`

    case 'nav-item':
      return `<span class="text-sm text-muted-foreground select-none" style="text-decoration:underline;text-underline-offset:2px">${text}</span>`

    default:
      return `<div class="text-sm text-muted-foreground select-none">${text}</div>`
  }
}
