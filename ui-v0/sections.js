// Frank — Section renderers
// Ports ALL section components from WireframeSection.tsx to plain JS + HTML string templates.

import { icon, headerIcon, navIcon } from './icons.js'
import { classify, displayLabel, smartItem } from './smart-item.js'

// ─── Section label helper ─────────────────────────────────────────────────────

function sectionLabel(text) {
  if (!text) return ''
  return `<div class="wf-section__label">${text}</div>`
}

// ─── Section routing ──────────────────────────────────────────────────────────

export function renderSection(section, screenLabel, platform) {
  const content = renderSectionContent(section, screenLabel, platform)
  if (section.note) {
    return `<div>
      ${content}
      <div class="wf-note">
        <span class="wf-note__marker">NOTE</span>
        <span>${section.note}</span>
      </div>
    </div>`
  }
  return content
}

function renderSectionContent(section, screenLabel, platform) {
  switch (section.type) {
    case 'header':          return headerSection(section)
    case 'hero':            return heroSection(section, platform)
    case 'content':         return contentSection(section)
    case 'top-nav':         return topNavSection(section)
    case 'bottom-nav':      return bottomNavSection(section, screenLabel)
    case 'sidebar':         return sidebarSection(section, screenLabel)
    case 'form':            return formSection(section)
    case 'messages':
    case 'chat':            return chatSection(section)
    case 'list':            return isChatList(section) ? chatSection(section) : listSection(section)
    case 'grid':            return gridSection(section)
    case 'footer':          return footerSection(section)
    case 'empty-state':     return emptyStateSection(section)
    case 'banner':          return bannerSection(section)
    case 'toolbar':         return toolbarSection(section)
    case 'modal':           return modalSection(section)
    case 'section-group':   return sectionGroupSection(section)
    case 'action-row':      return actionRowSection(section)
    case 'stats-row':       return statsRowSection(section)
    case 'loader':
    case 'splash':          return loaderSection(section)
    case 'map':             return mapSection(section)
    case 'category-strip':  return categoryStripSection(section)
    case 'place-list':      return placeListSection(section)
    case 'floating-search': return floatingSearchSection(section)
    case 'map-controls':    return mapControlsSection(section)
    case 'tabs':
    case 'tab-bar':         return tabsSection(section)
    case 'card-row':
    case 'feature-grid':
    case 'feature-list':    return featureSection(section)
    case 'chart':
    case 'graph':           return chartSection(section)
    case 'onboarding':
    case 'onboarding-step': return onboardingSection(section)
    case 'pricing':
    case 'pricing-table':   return pricingSection(section)
    case 'testimonial':
    case 'quote':           return testimonialSection(section)
    case 'image-gallery':
    case 'gallery':         return gallerySection(section)
    default:                return genericSection(section)
  }
}

// ─── Header classification helpers ────────────────────────────────────────────

const isLeftBtn  = (s) => /\b(back|close|dismiss|cancel|menu|hamburger)\b/i.test(s)
const isAvatar   = (s) => /\b(avatar|photo|picture)\b/i.test(s)
const isLogo     = (s) => /\b(logo|brand|wordmark)\b/i.test(s)
const isBtn      = (s) => /\bbutton\b/i.test(s) || isLeftBtn(s)
const isHeadline = (s) => /\b(headline|heading|title|label|name)\b/i.test(s) && !isBtn(s)
const isSubline  = (s) => /\b(subheadline|subtitle|status|online|caption|subline|description)\b/i.test(s) && !isBtn(s)

// ─── Header ───────────────────────────────────────────────────────────────────

function headerSection(section) {
  const items = section.contains

  const leftBtns   = items.filter(isLeftBtn)
  const logoItem   = items.find(isLogo)
  const avatarIdx  = items.findIndex(isAvatar)
  const avatarItem = avatarIdx >= 0 ? items[avatarIdx] : null

  // Chat / profile header: back + avatar + name/status + action buttons
  if (avatarItem && !logoItem) {
    const afterAvatar = items.slice(avatarIdx + 1)
    const nameItem    = afterAvatar.find(isHeadline)
    const statusItem  = afterAvatar.find(isSubline)
    const rightBtns   = items.filter(s => isBtn(s) && !isLeftBtn(s) && !isAvatar(s))

    return `<div class="flex items-center w-full gap-2">
      <div class="flex items-center flex-shrink-0" style="width:32px">
        ${leftBtns.map(item => `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0">${headerIcon(item)}</span>`).join('')}
      </div>
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--wf-muted);border:1px solid var(--wf-border);flex-shrink:0"></div>
        <div class="flex flex-col min-w-0">
          ${nameItem ? `<span class="text-sm font-semibold text-foreground leading-tight truncate select-none">${displayLabel(nameItem)}</span>` : ''}
          ${statusItem ? `<span class="text-xs text-muted-foreground leading-tight truncate select-none">${displayLabel(statusItem)}</span>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        ${rightBtns.map(item => `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0">${headerIcon(item)}</span>`).join('')}
      </div>
    </div>`
  }

  // App bar: logo + nav links + search + right actions
  if (logoItem) {
    const isInputItem  = (s) => /\binput\b|\bsearch\b/i.test(s)
    const isActionItem = (s) => /\b(button|btn|icon)\b/i.test(s) || /\bavatar\b/i.test(s)
    const navLinks     = items.filter(s => !isLogo(s) && !isInputItem(s) && !isActionItem(s))
    const inputItem    = items.find(isInputItem)
    const actionItems  = items.filter(s => isActionItem(s) && !isLogo(s))
    const cleanNavLabel = (s) => s.replace(/\s*(nav\s+)?(link|button|item)\s*$/i, '').trim() || s

    return `<div class="flex items-center w-full gap-2">
      <span class="text-sm font-semibold text-foreground select-none flex-shrink-0" style="margin-right:4px">
        ${displayLabel(logoItem)}
      </span>
      <nav class="flex items-center gap-3 flex-1 overflow-x-auto">
        ${navLinks.map((item, i) => `<span class="${i === 0 ? 'text-xs whitespace-nowrap select-none text-foreground font-medium' : 'text-xs whitespace-nowrap select-none text-muted-foreground'}">${cleanNavLabel(item)}</span>`).join('')}
      </nav>
      ${inputItem ? `<div class="flex items-center gap-1 bg-muted border rounded select-none flex-shrink-0" style="padding:4px 8px">
        ${icon('search', 11)}
        <span class="text-xs text-muted-foreground truncate" style="width:48px">${displayLabel(inputItem)}</span>
      </div>` : ''}
      <div class="flex items-center flex-shrink-0" style="gap:2px">
        ${actionItems.map(item => {
          if (/\bavatar\b/i.test(item)) {
            return `<div style="width:24px;height:24px;border-radius:50%;background:var(--wf-muted);border:1px solid var(--wf-border);flex-shrink:0;margin-left:4px"></div>`
          }
          return `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0" style="width:24px;height:24px">${headerIcon(item)}</span>`
        }).join('')}
      </div>
    </div>`
  }

  // Mobile nav bar: [left actions] [center title] [right actions]
  const rightBtns   = items.filter(s => isBtn(s) && !isLeftBtn(s))
  const centerItems = items.filter(s => !isBtn(s))

  return `<div class="flex items-center w-full">
    <div class="flex items-center gap-1 flex-shrink-0" style="width:40px">
      ${leftBtns.map(item => `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0">${headerIcon(item)}</span>`).join('')}
    </div>
    <div class="flex-1 flex justify-center items-center min-w-0 px-2">
      ${centerItems.slice(0, 1).map(item => `<span class="text-sm font-semibold text-foreground truncate select-none">${displayLabel(item)}</span>`).join('')}
    </div>
    <div class="flex items-center gap-1 flex-shrink-0" style="width:40px;justify-content:flex-end">
      ${rightBtns.map(item => `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0">${headerIcon(item)}</span>`).join('')}
    </div>
  </div>`
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function heroSection(section, platform) {
  const isWeb = platform === 'web' || platform === 'tablet'

  if (isWeb) {
    return `<div class="flex items-center" style="gap:48px;padding:48px 40px;min-height:320px">
      <div class="flex-1 flex flex-col items-start gap-4">
        ${section.label ? sectionLabel(section.label) : ''}
        ${section.contains.map(item => {
          if (classify(item) === 'headline') {
            return `<p style="font-size:36px" class="font-bold text-foreground leading-tight select-none">${displayLabel(item)}</p>`
          }
          return smartItem(item)
        }).join('')}
      </div>
      <div class="wf-image-placeholder flex-1" style="min-height:220px;border-radius:12px"></div>
    </div>`
  }

  return `<div class="flex flex-col items-center gap-3 select-none" style="text-align:center;padding:32px 16px">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => {
      if (classify(item) === 'headline') {
        return `<p class="text-2xl font-bold text-foreground leading-tight select-none" style="max-width:280px">${displayLabel(item)}</p>`
      }
      return smartItem(item)
    }).join('')}
  </div>`
}

// ─── Content ──────────────────────────────────────────────────────────────────

function contentSection(section) {
  return `<div class="flex flex-col items-start gap-3">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => smartItem(item)).join('')}
  </div>`
}

// ─── Top Nav ──────────────────────────────────────────────────────────────────

function topNavSection(section) {
  const isLogoItem = (s) => /\blogo\b/i.test(s)
  const isCta      = (s) => /\bbutton\b/i.test(s)
  const isAuth     = (s) => /\b(log\s*in|sign\s*in|login)\b/i.test(s)

  const logoItem = section.contains.find(isLogoItem)
  const ctaItem  = section.contains.find(isCta)
  const authItem = section.contains.find(isAuth)
  const navItems = section.contains.filter(s => !isLogoItem(s) && !isCta(s) && !isAuth(s))

  return `<div class="flex items-center px-4" style="height:56px;border-bottom:1px solid var(--wf-border)">
    ${logoItem ? `<span class="text-sm font-bold text-foreground select-none flex-shrink-0" style="margin-right:24px">${displayLabel(logoItem)}</span>` : ''}
    <nav class="flex items-center gap-1 flex-1">
      ${navItems.map(item => `<span class="text-sm text-muted-foreground select-none" style="padding:8px 12px;border-radius:6px">${item}</span>`).join('')}
    </nav>
    <div class="flex items-center gap-2 flex-shrink-0">
      ${authItem ? `<span class="text-sm text-muted-foreground select-none" style="padding:8px 12px">${authItem}</span>` : ''}
      ${ctaItem ? `<button class="wf-btn wf-btn--sm">${displayLabel(ctaItem)}</button>` : ''}
    </div>
  </div>`
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────

function bottomNavSection(section, screenLabel) {
  return section.contains.map((item, i) => {
    const active = screenLabel
      ? item.toLowerCase() === screenLabel.toLowerCase() ||
        screenLabel.toLowerCase().includes(item.toLowerCase())
      : i === 0
    const color = active ? 'var(--wf-text)' : 'var(--wf-text-muted)'

    return `<div class="flex flex-col items-center gap-1" style="color:${color}">
      ${navIcon(item)}
      <span class="text-xs font-medium select-none">${item}</span>
    </div>`
  }).join('')
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function sidebarSection(section, screenLabel) {
  return `<div class="flex flex-col gap-1">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map((item, i) => {
      const active = screenLabel
        ? item.toLowerCase() === screenLabel.toLowerCase() ||
          screenLabel.toLowerCase().includes(item.toLowerCase())
        : i === 0
      const bg = active ? 'background:var(--wf-bg);box-shadow:0 1px 2px rgba(0,0,0,0.06)' : ''
      const color = active ? 'var(--wf-text)' : 'var(--wf-text-muted)'

      return `<div class="flex items-center gap-2 text-sm font-medium select-none" style="padding:8px 12px;border-radius:6px;color:${color};${bg}">
        <span class="flex-shrink-0">${navIcon(item)}</span>
        <span>${item}</span>
      </div>`
    }).join('')}
  </div>`
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function formSection(section) {
  return `<div class="flex flex-col items-start gap-4">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => smartItem(item)).join('')}
  </div>`
}

// ─── Chat detection ───────────────────────────────────────────────────────────

function isChatList(section) {
  return section.contains.some(s => /\btext bubble\b|\bbubble (sent|received)\b/i.test(s))
    || /\bmessages?\b|\bchat\b/i.test(section.label ?? '')
}

// ─── Chat / Messages ──────────────────────────────────────────────────────────

function chatSection(section) {
  const isSent      = (s) => /\bsent\b/i.test(s)
  const isTimestamp = (s) => /\btimestamp\b/i.test(s) || /^\d{1,2}:\d{2}/.test(s.trim())
  const isTyping    = (s) => /\btyping\b/i.test(s)
  const msgText     = (s) => s
    .replace(/\s*text bubble\s*(sent|received)?\s*/i, '')
    .replace(/\s*bubble\s*(sent|received)?\s*/i, '')
    .trim()

  return `<div class="flex flex-col gap-2 px-4" style="padding-top:16px;padding-bottom:12px">
    ${section.contains.map((item, i) => {
      if (isTimestamp(item)) {
        return `<div class="flex justify-center py-3">
          <span class="text-xs text-muted-foreground bg-muted select-none" style="padding:4px 12px;border-radius:9999px">${msgText(item) || item}</span>
        </div>`
      }
      if (isTyping(item)) {
        return `<div class="flex items-end gap-2" style="margin-top:4px">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--wf-muted);border:1px solid var(--wf-border);flex-shrink:0"></div>
          <div style="background:var(--wf-muted);border:1px solid var(--wf-border);border-radius:16px 16px 16px 0;padding:12px 16px;display:flex;align-items:center;gap:4px">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--wf-text-muted);opacity:0.5;flex-shrink:0"></span>
            <span style="width:8px;height:8px;border-radius:50%;background:var(--wf-text-muted);opacity:0.5;flex-shrink:0"></span>
            <span style="width:8px;height:8px;border-radius:50%;background:var(--wf-text-muted);opacity:0.5;flex-shrink:0"></span>
          </div>
        </div>`
      }

      const sent = isSent(item)
      const text = msgText(item)
      const prevSent = i > 0 ? isSent(section.contains[i - 1]) : null
      const grouped  = prevSent === sent
      const mt = grouped ? '4px' : '12px'

      if (sent) {
        return `<div class="flex" style="justify-content:flex-end;padding-left:56px;margin-top:${mt}">
          <div style="background:var(--wf-text);color:var(--wf-primary-fg);border-radius:16px 16px 0 16px;padding:12px 16px;max-width:80%">
            <p class="text-base select-none" style="line-height:1.6">${text}</p>
          </div>
        </div>`
      }
      return `<div class="flex items-end gap-2" style="padding-right:56px;margin-top:${mt}">
        ${grouped
          ? `<div style="width:32px;flex-shrink:0"></div>`
          : `<div style="width:32px;height:32px;border-radius:50%;background:var(--wf-muted);border:1px solid var(--wf-border);flex-shrink:0"></div>`
        }
        <div style="background:var(--wf-muted);border:1px solid var(--wf-border);border-radius:16px 16px 16px 0;padding:12px 16px;max-width:80%">
          <p class="text-base select-none" style="line-height:1.6">${text}</p>
        </div>
      </div>`
    }).join('')}
  </div>`
}

// ─── List ─────────────────────────────────────────────────────────────────────

function listSection(section) {
  const hasTableHeaders = section.contains.some(s => /\bcolumn header\b/i.test(s))
  if (hasTableHeaders) return dataTableSection(section)

  return `<div class="flex flex-col">
    ${section.label ? `<div class="px-4" style="padding-top:12px;padding-bottom:4px">${sectionLabel(section.label)}</div>` : ''}
    ${section.contains.map((item, i) => `<div>
      <div class="flex items-center gap-3 px-4 py-3">
        <div class="wf-avatar" style="width:40px;height:40px;font-size:13px">${displayLabel(item).slice(0, 2).toUpperCase()}</div>
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="text-base font-medium text-foreground select-none leading-tight">${displayLabel(item)}</div>
          <div style="height:8px;width:66%;background:var(--wf-border);opacity:0.6;border-radius:4px"></div>
        </div>
        ${icon('chevron-right', 18)}
      </div>
      ${i < section.contains.length - 1 ? `<div class="wf-separator"></div>` : ''}
    </div>`).join('')}
  </div>`
}

// ─── Data Table ───────────────────────────────────────────────────────────────

function dataTableSection(section) {
  const isColHeader = (s) => /\bcolumn header\b/i.test(s)
  const isPaginate  = (s) => /\b(previous|next)\s+button\b/i.test(s) || /\bpage\s+\d+\s+of\s+/i.test(s)

  const headers    = section.contains.filter(isColHeader)
  const pagination = section.contains.filter(isPaginate)
  const rows       = section.contains.filter(s => !isColHeader(s) && !isPaginate(s))
  const cols       = headers.map(h => h.replace(/\s*column header\s*/i, '').trim())

  function renderCell(cell) {
    const c = cell.trim()
    const statusMatch = c.match(/^(fulfilled|processing|cancelled|pending|shipped|refunded)\s+badge$/i)
    if (statusMatch) {
      const status = statusMatch[1]
      const color =
        /fulfilled|shipped/i.test(status) ? '#16a34a' :
        /cancelled|refunded/i.test(status) ? '#ef4444' :
        /processing|pending/i.test(status) ? '#ca8a04' : 'var(--wf-text-muted)'
      const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
      return `<span class="wf-badge" style="color:${color};font-size:11px">${label}</span>`
    }
    if (/\blink\b$/i.test(c)) {
      const label = c.replace(/\s*link\s*$/i, '').trim() || 'View'
      return `<span class="text-xs select-none" style="color:#3b82f6;cursor:default">${label}</span>`
    }
    return `<span class="text-xs text-foreground select-none">${c}</span>`
  }

  let tableHtml = '<div class="flex flex-col w-full">'

  if (section.label) {
    tableHtml += `<div style="padding:12px 12px 4px" class="wf-section__label">${section.label}</div>`
  }

  tableHtml += '<div class="w-full overflow-x-auto"><table style="width:100%;font-size:11px;border-collapse:collapse">'

  if (cols.length > 0) {
    tableHtml += '<thead><tr style="border-bottom:1px solid var(--wf-border)">'
    cols.forEach(col => {
      tableHtml += `<th style="text-align:left;padding:8px 12px;font-size:11px;font-weight:600;color:var(--wf-text-muted);text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;user-select:none">${col}</th>`
    })
    tableHtml += '</tr></thead>'
  }

  tableHtml += '<tbody>'
  rows.forEach(row => {
    const cells = row.split(/\s*—\s*/).map(s => s.trim())
    tableHtml += '<tr style="border-bottom:1px solid rgba(228,228,231,0.4)">'
    cells.forEach(cell => {
      const c = cell.trim()
      const statusMatch = c.match(/^(fulfilled|processing|cancelled|pending|shipped|refunded)\s+badge$/i)
      let cellContent
      if (statusMatch) {
        const status = statusMatch[1]
        const color =
          /fulfilled|shipped/i.test(status) ? '#16a34a' :
          /cancelled|refunded/i.test(status) ? '#ef4444' :
          /processing|pending/i.test(status) ? '#ca8a04' : 'var(--wf-text-muted)'
        const label = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
        cellContent = `<span class="wf-badge" style="color:${color};font-size:11px">${label}</span>`
      } else if (/\blink\b$/i.test(c)) {
        const label = c.replace(/\s*link\s*$/i, '').trim() || 'View'
        cellContent = `<span style="font-size:11px;color:#3b82f6;cursor:default;user-select:none">${label}</span>`
      } else {
        cellContent = `<span style="font-size:11px;color:var(--wf-text);user-select:none">${c}</span>`
      }
      tableHtml += `<td style="padding:8px 12px;white-space:nowrap">${cellContent}</td>`
    })
    tableHtml += '</tr>'
  })
  tableHtml += '</tbody></table></div>'

  if (pagination.length > 0) {
    tableHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-top:1px solid var(--wf-border)">'
    pagination.forEach(item => {
      const isPageLabel = /\bpage\b/i.test(item) && !/\bbutton\b/i.test(item)
      if (isPageLabel) {
        tableHtml += `<span style="font-size:11px;color:var(--wf-text-muted);user-select:none">${item}</span>`
      } else {
        tableHtml += `<button class="wf-btn wf-btn--outline wf-btn--sm" style="height:24px;font-size:11px;padding:0 8px">${item.replace(/\s*button\s*$/i, '').trim()}</button>`
      }
    })
    tableHtml += '</div>'
  }

  tableHtml += '</div>'
  return tableHtml
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

function gridSection(section) {
  return `<div class="flex flex-col gap-3">
    ${section.label ? sectionLabel(section.label) : ''}
    <div class="grid grid-cols-2 gap-2">
      ${section.contains.map(item => `<div class="wf-card">
        <div class="wf-image-placeholder w-full" style="height:128px;border-radius:0;aspect-ratio:auto"></div>
        <div class="wf-card__content">
          <p class="text-sm font-medium text-foreground select-none">${displayLabel(item)}</p>
          ${item.includes('—') ? `<p class="text-xs text-muted-foreground select-none" style="margin-top:4px">${item.split('—')[1]?.trim()}</p>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </div>`
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function footerSection(section) {
  const isLogoItem  = (s) => /\blogo\b/i.test(s)
  const isCopyright = (s) => /^©/.test(s.trim())
  const logo        = section.contains.find(isLogoItem)
  const copyright   = section.contains.find(isCopyright)
  const links       = section.contains.filter(s => !isLogoItem(s) && !isCopyright(s))

  return `<div class="flex flex-col gap-3 px-4 py-4">
    <div class="flex items-center gap-4" style="flex-wrap:wrap">
      ${logo ? `<span style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:var(--wf-text);background:var(--wf-muted);border:1px solid var(--wf-border);border-radius:4px;padding:2px 8px;user-select:none;flex-shrink:0">LOGO</span>` : ''}
      <div class="flex" style="flex-wrap:wrap;gap:16px 16px">
        ${links.map(item => `<span class="text-xs text-muted-foreground select-none">${item}</span>`).join('')}
      </div>
    </div>
    ${copyright ? `<div class="text-xs text-muted-foreground select-none" style="opacity:0.6">${copyright}</div>` : ''}
  </div>`
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function emptyStateSection(section) {
  return `<div class="flex flex-col items-center gap-3" style="text-align:center">
    <div style="width:64px;height:64px;border-radius:16px;background:var(--wf-muted);border:1px solid var(--wf-border);margin-bottom:4px"></div>
    ${section.contains.map(item => smartItem(item)).join('')}
  </div>`
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function bannerSection(section) {
  const items   = section.contains.filter(c => !classify(c).startsWith('btn'))
  const actions = section.contains.filter(c =>  classify(c).startsWith('btn'))

  return `<div class="flex flex-col items-start gap-2">
    ${items.map(item => smartItem(item)).join('')}
    ${actions.map(item => smartItem(item)).join('')}
  </div>`
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function toolbarSection(section) {
  const isInput = (s) => /\binput\b|\btext field\b|\bsearch\b|\btype\b/i.test(s)

  return section.contains.map(item =>
    isInput(item)
      ? `<input class="wf-input flex-1" placeholder="${displayLabel(item)}" readonly>`
      : `<span class="wf-btn wf-btn--ghost wf-btn--icon flex-shrink-0" title="${item}">${headerIcon(item)}</span>`
  ).join('')
}

// ─── Section Group ────────────────────────────────────────────────────────────

function sectionGroupSection(section) {
  return `<div>
    ${section.label ? `<div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none" style="padding:12px 4px 8px">${section.label}</div>` : ''}
    <div style="background:var(--wf-bg);border:1px solid var(--wf-border);border-radius:12px;overflow:hidden">
      ${section.contains.map((item, i) => `<div>
        <div class="flex items-center px-4 py-3">
          ${smartItem(item)}
        </div>
        ${i < section.contains.length - 1 ? `<div style="height:1px;background:var(--wf-border);margin-left:16px"></div>` : ''}
      </div>`).join('')}
    </div>
  </div>`
}

// ─── Action Row ───────────────────────────────────────────────────────────────

function actionRowSection(section) {
  return `<div class="flex flex-col items-start gap-2">
    ${section.contains.map(item => smartItem(item)).join('')}
  </div>`
}

// ─── Stats Row ────────────────────────────────────────────────────────────────

function parseStatCard(raw) {
  if (raw.includes(' — ')) {
    const parts = raw.split(' — ').map(s => s.trim())
    const label = parts[0]?.replace(/\s*stat\s*card\s*/i, '').trim() ?? ''
    const value = parts.find(p => /\bvalue\b$/i.test(p))?.replace(/\s*value\s*$/i, '').trim() ?? ''
    const badge = parts.find(p => /\bbadge\b$/i.test(p))?.replace(/\s*badge\s*$/i, '').trim() ?? ''
    return { label, value, badge }
  }
  const words = raw.split(/\s+/)
  return { label: words.slice(1).join(' '), value: words[0] ?? '', badge: '' }
}

function statsRowSection(section) {
  const isRich = section.contains.some(s => s.includes(' — '))

  if (isRich) {
    return `<div class="grid grid-cols-2 gap-2 p-3">
      ${section.contains.map(item => {
        const { label, value, badge } = parseStatCard(item)
        const trend = badge.startsWith('+') ? 'up' : badge.startsWith('-') ? 'down' : null
        const badgeColor = trend === 'up' ? '#16a34a' : trend === 'down' ? '#ef4444' : 'var(--wf-text-muted)'

        return `<div class="flex flex-col gap-1" style="padding:12px;border-radius:8px;border:1px solid var(--wf-border);background:var(--wf-bg)">
          <div class="text-xs text-muted-foreground select-none leading-tight">${label}</div>
          <div class="text-lg font-bold text-foreground select-none">${value}</div>
          ${badge ? `<span class="text-xs font-medium select-none" style="color:${badgeColor}">${badge}</span>` : ''}
        </div>`
      }).join('')}
    </div>`
  }

  return `<div class="flex flex-row" style="border-top:1px solid var(--wf-border);border-bottom:1px solid var(--wf-border)">
    ${section.contains.map((item, i) => {
      const { value, label } = parseStatCard(item)
      const borderRight = i < section.contains.length - 1 ? 'border-right:1px solid var(--wf-border)' : ''

      return `<div class="flex-1 flex flex-col items-center gap-1" style="padding:16px;${borderRight}">
        <div class="text-2xl font-bold text-foreground select-none">${value}</div>
        <div class="text-xs text-muted-foreground select-none" style="text-align:center">${label}</div>
      </div>`
    }).join('')}
  </div>`
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function modalSection(section) {
  const actionItems = section.contains.filter(c => classify(c).startsWith('btn'))
  const bodyItems   = section.contains.filter(c => !classify(c).startsWith('btn'))

  return `<div class="w-full flex items-center justify-center">
    <div style="background:var(--wf-bg);border:1px solid var(--wf-border);border-radius:12px;width:85%;max-width:320px;box-shadow:0 4px 24px rgba(0,0,0,0.12);overflow:hidden">
      <div class="flex items-center justify-between px-4 py-3" style="border-bottom:1px solid var(--wf-border)">
        <span class="text-sm font-semibold text-foreground select-none">${section.label ?? 'Dialog'}</span>
        <span class="wf-btn wf-btn--ghost wf-btn--icon" style="width:24px;height:24px">${icon('x', 14)}</span>
      </div>
      <div class="px-4 py-3 flex flex-col gap-2">
        ${bodyItems.map(item => smartItem(item)).join('')}
      </div>
      ${actionItems.length > 0 ? `<div class="px-4 flex gap-2" style="padding-bottom:12px;padding-top:12px;justify-content:flex-end;border-top:1px solid var(--wf-border)">
        ${actionItems.map(item => smartItem(item)).join('')}
      </div>` : ''}
    </div>
  </div>`
}

// ─── Loader / Splash ──────────────────────────────────────────────────────────

function loaderSection(section) {
  const desc = section.contains[0] ? displayLabel(section.contains[0]) : null

  // Simple loader: spinning ring + optional description
  return `<div class="flex flex-col items-center justify-center gap-4" style="padding:80px 0">
    <div style="width:40px;height:40px;border:3px solid var(--wf-border);border-top-color:var(--wf-text);border-radius:50%;animation:wf-loader-spin 0.8s linear infinite"></div>
    ${desc ? `<p class="text-xs text-muted-foreground select-none" style="text-align:center;max-width:240px">${desc}</p>` : ''}
  </div>`
}

// ─── Map ──────────────────────────────────────────────────────────────────────

function mapSection(_section) {
  return `<div class="wf-image-placeholder w-full" style="min-height:260px;border-radius:0;display:flex;align-items:center;justify-content:center">
    ${icon('map-pin', 32)}
  </div>`
}

// ─── Floating Search ──────────────────────────────────────────────────────────

function floatingSearchSection(section) {
  const hasAvatar  = section.contains.some(s => /\bavatar\b/i.test(s))
  const searchItem = section.contains.find(s => !/\bavatar\b/i.test(s))

  return `<div class="flex items-center gap-2 px-4 py-3">
    <div class="flex-1 flex items-center gap-2" style="background:var(--wf-bg);border:1px solid var(--wf-border);border-radius:9999px;padding:8px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      ${icon('search', 14)}
      <span class="text-sm text-muted-foreground select-none flex-1">${displayLabel(searchItem ?? 'Search')}</span>
    </div>
    ${hasAvatar ? `<div class="wf-avatar wf-avatar--sm" style="width:32px;height:32px;font-size:10px">Me</div>` : ''}
  </div>`
}

// ─── Map Controls ─────────────────────────────────────────────────────────────

function mapControlsSection(section) {
  return `<div class="flex flex-col items-end gap-2 px-4 py-2">
    ${section.contains.map(item => `<span class="wf-btn wf-btn--outline wf-btn--icon" style="border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06)" title="${item}">${headerIcon(item)}</span>`).join('')}
  </div>`
}

// ─── Category Strip ───────────────────────────────────────────────────────────

function categoryStripSection(section) {
  return `<div class="flex items-center gap-2 overflow-x-auto px-4 py-3">
    ${section.contains.map(item => `<span class="wf-badge whitespace-nowrap flex-shrink-0" style="padding:4px 12px;border-radius:9999px">${item}</span>`).join('')}
  </div>`
}

// ─── Place List ───────────────────────────────────────────────────────────────

function placeListSection(section) {
  return `<div class="flex flex-col">
    ${section.label ? `<div class="px-4" style="padding-top:12px;padding-bottom:4px">${sectionLabel(section.label)}</div>` : ''}
    ${section.contains.map((item, i) => {
      const parts = item.split('—').map(s => s.trim())
      const name = parts[0]
      const distance = parts[1] || null

      return `<div>
        <div class="flex items-center gap-3 px-4 py-3">
          <div style="width:40px;height:40px;border-radius:12px;background:var(--wf-muted);border:1px solid var(--wf-border);display:flex;align-items:center;justify-content:center;flex-shrink:0">
            ${icon('map-pin', 16)}
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-foreground select-none">${name}</div>
            ${distance ? `<div class="text-xs text-muted-foreground select-none">${distance}</div>` : ''}
          </div>
          ${icon('chevron-right', 16)}
        </div>
        ${i < section.contains.length - 1 ? `<div class="wf-separator"></div>` : ''}
      </div>`
    }).join('')}
  </div>`
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function tabsSection(section) {
  return `<div class="flex" style="border-bottom:1px solid var(--wf-border)">
    ${section.contains.map((item, i) => `<div class="text-sm font-medium select-none whitespace-nowrap cursor-default" style="padding:12px 16px;${i === 0 ? 'color:var(--wf-text);border-bottom:2px solid var(--wf-text)' : 'color:var(--wf-text-muted)'}">${item}</div>`).join('')}
  </div>`
}

// ─── Feature Section (card-row, feature-grid, feature-list) ───────────────────

function featureSection(section) {
  const isGrid = section.layout === 'grid' || section.type === 'feature-grid'

  return `<div class="flex flex-col gap-3">
    ${section.label ? sectionLabel(section.label) : ''}
    <div class="${isGrid ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2'}">
      ${section.contains.map(item => {
        const parts = item.split('—').map(s => s.trim())
        const title = parts[0]
        const desc  = parts[1] || null

        return `<div class="flex items-start gap-3" style="padding:12px;border-radius:8px;border:1px solid var(--wf-border);background:var(--wf-bg)">
          <div style="width:32px;height:32px;border-radius:8px;background:var(--wf-muted);border:1px solid var(--wf-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--wf-text-muted)">
            ${headerIcon(title)}
          </div>
          <div class="flex flex-col gap-1 min-w-0">
            <span class="text-sm font-medium text-foreground select-none">${title}</span>
            ${desc ? `<span class="text-xs text-muted-foreground select-none">${desc}</span>` : ''}
          </div>
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ─── Chart ────────────────────────────────────────────────────────────────────

function chartSection(section) {
  const contains = section.contains

  // Time-period selector tabs
  const tabItems = contains.filter(s => /\bselector\s+tab\b/i.test(s))

  // Line chart detection
  const isLine = contains.some(s => /\bline\s*(chart|graph)\b/i.test(s))

  // Axis labels
  const axisRaw = contains.find(s => /\baxis\s+labels?\b/i.test(s))
  let axisLabels = null
  if (axisRaw) {
    const match = axisRaw.match(/^(.*?)\s*—?\s*axis\s+labels?\s*$/i)
    const raw = match?.[1] ?? axisRaw
    const afterDash = raw.includes('—') ? raw.split('—').pop().trim() : raw.trim()
    axisLabels = afterDash.split(/[,]\s*/).map(s => s.trim()).filter(Boolean)
  }

  // Named series
  const lineItems = contains.filter(s => /\bline\s*—\s*(blue|violet|green|red|orange|purple)/i.test(s))

  const tabs = tabItems.length > 0 ? `<div class="flex gap-1" style="justify-content:flex-end">
    ${tabItems.map(tab => {
      const label = tab.replace(/\s*selector\s+tab\s*/i, '').replace(/\s*\bactive\b\s*/i, '').trim()
      const isActive = /\bactive\b/i.test(tab)
      return `<span class="text-xs select-none" style="padding:2px 8px;border-radius:4px;${isActive ? 'background:var(--wf-text);color:var(--wf-primary-fg);font-weight:500' : 'color:var(--wf-text-muted);border:1px solid var(--wf-border)'}">${label}</span>`
    }).join('')}
  </div>` : ''

  const chart = isLine
    ? lineChartViz(axisLabels, lineItems)
    : barChartViz()

  return `<div class="flex flex-col gap-2 w-full">
    ${section.label ? `<div style="padding:0 16px">${sectionLabel(section.label)}</div>` : ''}
    ${tabs ? `<div style="padding:0 16px">${tabs}</div>` : ''}
    ${chart}
  </div>`
}

function lineChartViz(axisLabels, lineItems) {
  const W = 400, H = 180, px = 10, py = 18
  const blueData   = [38, 52, 45, 63, 58, 74]
  const violetData = [28, 34, 41, 36, 45, 50]
  const n = blueData.length

  const toX = (i) => px + (i / (n - 1)) * (W - px * 2)
  const toY = (v) => py + (1 - (v - 20) / 60) * (H - py * 2)
  const pathD = (d) => d.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const areaD = (d) =>
    `${pathD(d)} L${toX(n - 1).toFixed(1)},${(H - py).toFixed(1)} L${toX(0).toFixed(1)},${(H - py).toFixed(1)} Z`

  const seriesColors = lineItems.map(item =>
    /blue/i.test(item) ? '#3b82f6' : /violet/i.test(item) ? '#8b5cf6' : '#10b981'
  )
  const allData = [blueData, violetData]

  // Build SVG as string
  let svgContent = ''

  // Grid lines
  ;[0.25, 0.5, 0.75].forEach(p => {
    const y = py + p * (H - py * 2)
    svgContent += `<line x1="${px}" y1="${y}" x2="${W - px}" y2="${y}" stroke="var(--wf-border)" stroke-width="0.5" stroke-dasharray="3 2"/>`
  })

  // Areas + lines
  allData.forEach((d, si) => {
    const color = seriesColors[si] ?? '#888'
    svgContent += `<path d="${areaD(d)}" fill="${color}" fill-opacity="0.07"/>`
    svgContent += `<path d="${pathD(d)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
  })

  // Axis labels
  if (axisLabels) {
    axisLabels.slice(0, n).forEach((label, i) => {
      svgContent += `<text x="${toX(i)}" y="${H - 2}" text-anchor="middle" font-size="7" fill="var(--wf-text-muted)" style="user-select:none">${label}</text>`
    })
  }

  const svgStr = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${svgContent}</svg>`

  // Legend
  let legendHtml = ''
  if (lineItems.length > 0) {
    const legendItems = lineItems.map((item, i) => {
      const name = item.split(/\s*—\s*/)[0]?.replace(/\s*line\s*/i, '').trim() ?? item
      const color = seriesColors[i] ?? '#888'
      return `<div style="display:flex;align-items:center;gap:6px"><div style="width:16px;height:2px;border-radius:2px;background:${color}"></div><span style="font-size:11px;color:var(--wf-text-muted);user-select:none">${name}</span></div>`
    }).join('')
    legendHtml = `<div style="display:flex;gap:16px;padding:0 8px;margin-top:4px">${legendItems}</div>`
  }

  return `<div style="width:100%">${svgStr}${legendHtml}</div>`
}

function barChartViz() {
  const bars = [65, 45, 80, 55, 70, 40, 75]
  let barHtml = ''
  bars.forEach(h => {
    barHtml += `<div style="flex:1;background:rgba(24,24,27,0.15);border:1px solid var(--wf-border);border-radius:2px 2px 0 0;height:${h}%"></div>`
  })

  // Grid lines
  let gridHtml = ''
  ;[0.25, 0.5, 0.75].forEach(p => {
    gridHtml += `<div style="position:absolute;width:100%;border-top:1px solid rgba(228,228,231,0.6);top:${p * 100}%"></div>`
  })

  return `<div style="width:100%;height:160px;background:var(--wf-muted);border:1px solid var(--wf-border);border-radius:8px;position:relative;overflow:hidden">${gridHtml}<div style="position:absolute;inset:16px 16px 0;display:flex;align-items:flex-end;justify-content:space-between;gap:8px;height:100%;padding-bottom:0">${barHtml}</div></div>`
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function onboardingSection(section) {
  const stepItems = section.contains.filter(s => !classify(s).startsWith('btn'))
  const btnItems  = section.contains.filter(s =>  classify(s).startsWith('btn'))

  return `<div class="flex flex-col items-center gap-6" style="text-align:center;padding:32px 16px">
    <div class="wf-image-placeholder" style="width:96px;height:96px;border-radius:16px;aspect-ratio:auto"></div>
    <div class="flex flex-col gap-2" style="max-width:280px">
      ${stepItems.map(item => {
        if (classify(item) === 'headline') return `<p class="text-xl font-bold text-foreground select-none">${displayLabel(item)}</p>`
        return smartItem(item)
      }).join('')}
    </div>
    ${btnItems.length > 0 ? `<div class="flex flex-col items-center gap-2">
      ${btnItems.map(item => smartItem(item)).join('')}
    </div>` : ''}
    <div class="flex gap-2">
      <div style="height:8px;width:16px;border-radius:9999px;background:var(--wf-text)"></div>
      <div style="height:8px;width:8px;border-radius:9999px;background:var(--wf-border)"></div>
      <div style="height:8px;width:8px;border-radius:9999px;background:var(--wf-border)"></div>
    </div>
  </div>`
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function pricingSection(section) {
  return `<div class="flex flex-col gap-3">
    ${section.label ? sectionLabel(section.label) : ''}
    <div class="grid grid-cols-2 gap-3">
      ${section.contains.map((item, i) => {
        const parts = item.split('—').map(s => s.trim())
        const name = parts[0]
        const price = parts[1] || null
        const featured = i === 1

        const cardStyle = featured
          ? 'border:1px solid var(--wf-text);background:var(--wf-text);color:var(--wf-primary-fg)'
          : 'border:1px solid var(--wf-border);background:var(--wf-bg)'
        const nameColor = featured ? 'opacity:0.7' : 'color:var(--wf-text-muted)'
        const priceColor = featured ? '' : 'color:var(--wf-text)'
        const barBg = featured ? 'rgba(255,255,255,0.2)' : 'var(--wf-border)'

        return `<div class="flex flex-col gap-3" style="padding:16px;border-radius:12px;${cardStyle}">
          <span class="text-xs font-semibold uppercase tracking-wider select-none" style="${nameColor}">${name}</span>
          ${price ? `<span class="text-2xl font-bold select-none" style="${priceColor}">${price}</span>` : ''}
          <div style="height:8px;border-radius:2px;background:${barBg};width:70%"></div>
          <div style="height:8px;border-radius:2px;background:${barBg};width:55%"></div>
          <div style="height:8px;border-radius:2px;background:${barBg};width:40%"></div>
          <button class="${featured ? 'wf-btn wf-btn--outline' : 'wf-btn wf-btn--outline'} wf-btn--sm" style="margin-top:4px;${featured ? 'background:var(--wf-primary-fg);color:var(--wf-text);border-color:var(--wf-primary-fg)' : ''}">Get started</button>
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ─── Testimonial ──────────────────────────────────────────────────────────────

function testimonialSection(section) {
  return `<div class="flex flex-col gap-4">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => {
      const parts = item.split('—').map(s => s.trim())
      const quote  = parts[0]
      const author = parts[1] || null

      return `<div class="flex flex-col gap-3" style="padding:16px;border-radius:12px;border:1px solid var(--wf-border);background:var(--wf-bg)">
        <div class="flex flex-col gap-1">
          <div style="height:8px;background:var(--wf-border);border-radius:2px;width:100%"></div>
          <div style="height:8px;background:var(--wf-border);border-radius:2px;width:85%"></div>
          <div style="height:8px;background:var(--wf-border);border-radius:2px;width:70%"></div>
        </div>
        ${quote ? `<p class="text-sm text-muted-foreground select-none" style="font-style:italic">"${quote}"</p>` : ''}
        ${author ? `<div class="flex items-center gap-2">
          <div class="wf-avatar wf-avatar--sm">${author.slice(0, 2).toUpperCase()}</div>
          <span class="text-xs font-medium text-foreground select-none">${author}</span>
        </div>` : ''}
      </div>`
    }).join('')}
  </div>`
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

function gallerySection(section) {
  return `<div class="flex flex-col gap-3">
    ${section.label ? sectionLabel(section.label) : ''}
    <div class="grid grid-cols-3 gap-2">
      ${section.contains.map(item => `<div class="wf-image-placeholder" style="aspect-ratio:1;border-radius:6px"></div>`).join('')}
    </div>
  </div>`
}

// ─── Generic (fallback) ───────────────────────────────────────────────────────

function genericSection(section) {
  const items = section.contains
  const layout = section.layout

  // Chips: explicit row layout, or all short items
  const allShort = items.every(s => s.length < 20 && !/\b(button|input|image|avatar|headline|subheadline|body|toggle|chevron)\b/i.test(s))
  const isChips  = layout === 'row' || (allShort && items.length >= 3)

  // Detail rows: items contain em-dash
  const isDetailList = !isChips && items.some(s => s.includes('—'))

  // Nav links: items look like navigation labels
  const isNav = !isChips && !isDetailList && items.every(s => s.length < 24 && /^[A-Z]/.test(s))

  if (isChips) {
    return `<div class="flex flex-col gap-2 w-full">
      ${section.label ? sectionLabel(section.label) : ''}
      <div class="flex items-center gap-2" style="flex-wrap:wrap">
        ${items.map(item => `<span class="wf-badge" style="border-radius:9999px;padding:4px 12px">${displayLabel(item)}</span>`).join('')}
      </div>
    </div>`
  }

  if (isDetailList) {
    return `<div class="flex flex-col gap-2 w-full">
      ${section.label ? sectionLabel(section.label) : ''}
      <div class="flex flex-col">
        ${items.map((item, i) => {
          const parts = item.split('—').map(s => s.trim())
          const name = parts[0]
          const detail = parts[1] || null

          return `<div>
            <div class="flex items-center gap-3 py-3">
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-foreground select-none">${name}</div>
                ${detail ? `<div class="text-xs text-muted-foreground select-none">${detail}</div>` : ''}
              </div>
              ${icon('chevron-right', 16)}
            </div>
            ${i < items.length - 1 ? `<div class="wf-separator"></div>` : ''}
          </div>`
        }).join('')}
      </div>
    </div>`
  }

  if (isNav) {
    return `<div class="flex flex-col gap-2 w-full">
      ${section.label ? sectionLabel(section.label) : ''}
      <div class="flex items-center gap-1" style="flex-wrap:wrap">
        ${items.map(item => `<span class="text-sm text-muted-foreground select-none" style="padding:8px 12px;border-radius:6px">${item}</span>`).join('')}
      </div>
    </div>`
  }

  // Default: stack of smart items
  return `<div class="flex flex-col gap-2 w-full">
    ${section.label ? sectionLabel(section.label) : ''}
    <div class="flex flex-col items-start gap-2">
      ${items.map(item => smartItem(item)).join('')}
    </div>
  </div>`
}
