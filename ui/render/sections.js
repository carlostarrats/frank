// Frank — Section renderers (shadcn-quality)
// Each renderer returns an HTML string that matches shadcn/ui visual quality.

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
    case 'header':          return headerSection(section, platform)
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

function headerSection(section, platform) {
  const items = section.contains

  const leftBtns   = items.filter(isLeftBtn)
  const logoItem   = items.find(isLogo)
  const avatarIdx  = items.findIndex(isAvatar)
  const avatarItem = avatarIdx >= 0 ? items[avatarIdx] : null

  // Chat / profile header: back + avatar + name/status + action buttons
  if (avatarItem && !logoItem && platform !== 'web') {
    const afterAvatar = items.slice(avatarIdx + 1)
    const nameItem    = afterAvatar.find(isHeadline)
    const statusItem  = afterAvatar.find(isSubline)
    const rightBtns   = items.filter(s => isBtn(s) && !isLeftBtn(s) && !isAvatar(s))

    return `<div class="sc-header" style="gap:8px">
      <div style="display:flex;align-items:center;flex-shrink:0;width:32px">
        ${leftBtns.map(item => `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:28px;height:28px">${headerIcon(item)}</span>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <div class="sc-avatar" style="width:34px;height:34px">${avatarItem ? displayLabel(avatarItem).slice(0, 2).toUpperCase() : 'U'}</div>
        <div style="display:flex;flex-direction:column;min-width:0">
          ${nameItem ? `<span style="font-size:14px;font-weight:600;color:var(--foreground);line-height:1.3;user-select:none">${displayLabel(nameItem)}</span>` : ''}
          ${statusItem ? `<span style="font-size:12px;color:var(--muted-foreground);line-height:1.3;user-select:none">${displayLabel(statusItem)}</span>` : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2px;flex-shrink:0">
        ${rightBtns.map(item => `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:28px;height:28px">${headerIcon(item)}</span>`).join('')}
      </div>
    </div>`
  }

  // Web app header bar: headline + search + actions (used inside sidebar layout)
  if (platform === 'web') {
    const headlineItem = items.find(isHeadline)
    const isInputItem  = (s) => /\binput\b|\bsearch\b/i.test(s)
    const isActionItem = (s) => /\b(button|btn|icon)\b/i.test(s) || /\bavatar\b/i.test(s)
    const inputItem    = items.find(isInputItem)
    const actionItems  = items.filter(s => isActionItem(s) && !isLogo(s) && !isHeadline(s))
    const navLinks     = items.filter(s => !isLogo(s) && !isInputItem(s) && !isActionItem(s) && !isHeadline(s))
    const cleanNavLabel = (s) => s.replace(/\s*(nav\s+)?(link|button|item)\s*$/i, '').replace(/\s+active\s*$/i, '').trim() || s

    return `<div class="sc-header">
      ${headlineItem ? `<h1 style="font-size:20px;font-weight:600;color:var(--foreground);letter-spacing:-0.01em;user-select:none;flex-shrink:0">${displayLabel(headlineItem)}</h1>` : ''}
      ${logoItem && !headlineItem ? `<span class="sc-header-logo">${displayLabel(logoItem)}</span>` : ''}
      ${navLinks.length > 0 ? `<nav class="sc-nav" style="margin-left:8px">${navLinks.map((item, i) => {
        const isActive = /\bactive\b/i.test(item) || i === 0
        return `<span class="sc-nav-item${isActive ? ' sc-nav-item--active' : ''}">${cleanNavLabel(item)}</span>`
      }).join('')}</nav>` : ''}
      <div style="flex:1"></div>
      ${inputItem ? `<div class="sc-header-search">
        ${icon('search', 14)}
        <span style="user-select:none">${displayLabel(inputItem)}</span>
      </div>` : ''}
      <div class="sc-header-actions">
        ${actionItems.map(item => {
          if (/\bavatar\b/i.test(item)) {
            return `<div class="sc-avatar" style="margin-left:4px">${displayLabel(item).slice(0, 2).toUpperCase() || 'U'}</div>`
          }
          return `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:32px;height:32px">${headerIcon(item)}</span>`
        }).join('')}
      </div>
    </div>`
  }

  // App bar with logo + nav links (desktop without sidebar)
  if (logoItem) {
    const isInputItem  = (s) => /\binput\b|\bsearch\b/i.test(s)
    const isActionItem = (s) => /\b(button|btn|icon)\b/i.test(s) || /\bavatar\b/i.test(s)
    const navLinks     = items.filter(s => !isLogo(s) && !isInputItem(s) && !isActionItem(s))
    const inputItem    = items.find(isInputItem)
    const actionItems  = items.filter(s => isActionItem(s) && !isLogo(s))
    const cleanNavLabel = (s) => s.replace(/\s*(nav\s+)?(link|button|item)\s*$/i, '').replace(/\s+active\s*$/i, '').trim() || s

    return `<div class="sc-header">
      <span class="sc-header-logo">${displayLabel(logoItem)}</span>
      <nav class="sc-nav" style="flex:1;margin-left:8px">
        ${navLinks.map((item, i) => {
          const isActive = /\bactive\b/i.test(item) || i === 0
          return `<span class="sc-nav-item${isActive ? ' sc-nav-item--active' : ''}">${cleanNavLabel(item)}</span>`
        }).join('')}
      </nav>
      ${inputItem ? `<div class="sc-header-search">
        ${icon('search', 14)}
        <span style="user-select:none">${displayLabel(inputItem)}</span>
      </div>` : ''}
      <div class="sc-header-actions">
        ${actionItems.map(item => {
          if (/\bavatar\b/i.test(item)) {
            return `<div class="sc-avatar" style="margin-left:4px">${displayLabel(item).slice(0, 2).toUpperCase() || 'U'}</div>`
          }
          return `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:32px;height:32px">${headerIcon(item)}</span>`
        }).join('')}
      </div>
    </div>`
  }

  // Mobile nav bar: [left actions] [center title] [right actions]
  const rightBtns   = items.filter(s => isBtn(s) && !isLeftBtn(s))
  const centerItems = items.filter(s => !isBtn(s))

  return `<div class="sc-header" style="padding:0 16px">
    <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;width:40px">
      ${leftBtns.map(item => `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:28px;height:28px">${headerIcon(item)}</span>`).join('')}
    </div>
    <div style="flex:1;display:flex;justify-content:center;align-items:center;min-width:0;padding:0 8px">
      ${centerItems.slice(0, 1).map(item => `<span style="font-size:16px;font-weight:600;color:var(--foreground);user-select:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${displayLabel(item)}</span>`).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;width:40px;justify-content:flex-end">
      ${rightBtns.map(item => `<span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:28px;height:28px">${headerIcon(item)}</span>`).join('')}
    </div>
  </div>`
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function heroSection(section, platform) {
  const isWeb = platform === 'web' || platform === 'tablet'

  if (isWeb) {
    return `<div style="display:flex;align-items:center;gap:48px;padding:64px 48px;min-height:360px">
      <div style="flex:1;display:flex;flex-direction:column;align-items:flex-start;gap:16px">
        ${section.label ? sectionLabel(section.label) : ''}
        ${section.contains.map(item => {
          if (classify(item) === 'headline') {
            return `<h1 style="font-size:42px;font-weight:700;color:var(--foreground);line-height:1.15;letter-spacing:-0.02em;user-select:none">${displayLabel(item)}</h1>`
          }
          if (classify(item) === 'subheadline') {
            return `<p style="font-size:18px;color:var(--muted-foreground);line-height:1.6;max-width:480px;user-select:none">${displayLabel(item)}</p>`
          }
          return smartItem(item)
        }).join('')}
      </div>
      <div class="sc-image-placeholder" style="flex:1;min-height:240px;border-radius:var(--radius)"></div>
    </div>`
  }

  return `<div style="display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;padding:40px 20px">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => {
      if (classify(item) === 'headline') {
        return `<h1 style="font-size:28px;font-weight:700;color:var(--foreground);line-height:1.2;letter-spacing:-0.02em;user-select:none;max-width:280px">${displayLabel(item)}</h1>`
      }
      return smartItem(item)
    }).join('')}
  </div>`
}

// ─── Content ──────────────────────────────────────────────────────────────────

function contentSection(section) {
  return `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:16px">
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

  return `<div class="sc-header">
    ${logoItem ? `<span class="sc-header-logo" style="margin-right:16px">${displayLabel(logoItem)}</span>` : ''}
    <nav class="sc-nav" style="flex:1">
      ${navItems.map((item, i) => `<span class="sc-nav-item${i === 0 ? ' sc-nav-item--active' : ''}">${item}</span>`).join('')}
    </nav>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      ${authItem ? `<span class="sc-nav-item">${authItem}</span>` : ''}
      ${ctaItem ? `<button class="sc-btn sc-btn--sm">${displayLabel(ctaItem)}</button>` : ''}
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
    const color = active ? 'var(--foreground)' : 'var(--muted-foreground)'

    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;color:${color}">
      ${navIcon(item)}
      <span style="font-size:11px;font-weight:${active ? '600' : '500'};user-select:none">${item}</span>
    </div>`
  }).join('')
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function sidebarSection(section, screenLabel) {
  const items = section.contains
  const logoItem = items.find(isLogo)
  const navItems = items.filter(s => !isLogo(s))

  return `<div class="sc-sidebar">
    <div class="sc-sidebar-header">
      ${logoItem
        ? `<span class="sc-header-logo">${displayLabel(logoItem)}</span>`
        : `<span class="sc-header-logo">${screenLabel || 'App'}</span>`
      }
    </div>
    <div class="sc-sidebar-content">
      ${navItems.map((item, i) => {
        const cleanLabel = item
          .replace(/\s*(nav\s+)?(link|button|item)\s*$/i, '')
          .replace(/\s+active\s*$/i, '')
          .trim() || item
        const isActive = /\bactive\b/i.test(item) || (screenLabel
          ? cleanLabel.toLowerCase() === screenLabel.toLowerCase() ||
            screenLabel.toLowerCase().includes(cleanLabel.toLowerCase())
          : i === 0)

        return `<div class="sc-sidebar-item${isActive ? ' sc-sidebar-item--active' : ''}">
          <span style="flex-shrink:0;display:flex;align-items:center">${navIcon(cleanLabel)}</span>
          <span>${cleanLabel}</span>
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ─── Form ─────────────────────────────────────────────────────────────────────

function formSection(section) {
  return `<div style="display:flex;flex-direction:column;align-items:stretch;gap:16px;padding:20px">
    ${section.label ? `<h3 style="font-size:18px;font-weight:600;color:var(--foreground);letter-spacing:-0.01em;user-select:none">${section.label}</h3>` : ''}
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

  return `<div style="display:flex;flex-direction:column;gap:8px;padding:16px">
    ${section.contains.map((item, i) => {
      if (isTimestamp(item)) {
        return `<div style="display:flex;justify-content:center;padding:8px 0">
          <span style="font-size:12px;color:var(--muted-foreground);background:var(--muted);padding:4px 12px;border-radius:9999px;user-select:none">${msgText(item) || item}</span>
        </div>`
      }
      if (isTyping(item)) {
        return `<div style="display:flex;align-items:flex-end;gap:8px;margin-top:4px">
          <div class="sc-avatar" style="width:28px;height:28px;font-size:10px">...</div>
          <div style="background:var(--muted);border-radius:16px 16px 16px 0;padding:10px 14px;display:flex;align-items:center;gap:4px">
            <span style="width:6px;height:6px;border-radius:50%;background:var(--muted-foreground);opacity:0.4"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--muted-foreground);opacity:0.4"></span>
            <span style="width:6px;height:6px;border-radius:50%;background:var(--muted-foreground);opacity:0.4"></span>
          </div>
        </div>`
      }

      const sent = isSent(item)
      const text = msgText(item)
      const prevSent = i > 0 ? isSent(section.contains[i - 1]) : null
      const grouped  = prevSent === sent
      const mt = grouped ? '2px' : '8px'

      if (sent) {
        return `<div style="display:flex;justify-content:flex-end;padding-left:56px;margin-top:${mt}">
          <div style="background:var(--primary);color:var(--primary-foreground);border-radius:16px 16px 4px 16px;padding:10px 14px;max-width:80%">
            <p style="font-size:14px;line-height:1.5;user-select:none">${text}</p>
          </div>
        </div>`
      }
      return `<div style="display:flex;align-items:flex-end;gap:8px;padding-right:56px;margin-top:${mt}">
        ${grouped
          ? `<div style="width:28px;flex-shrink:0"></div>`
          : `<div class="sc-avatar" style="width:28px;height:28px;font-size:10px">${text.slice(0, 1).toUpperCase()}</div>`
        }
        <div style="background:var(--muted);border-radius:16px 16px 16px 4px;padding:10px 14px;max-width:80%">
          <p style="font-size:14px;line-height:1.5;user-select:none">${text}</p>
        </div>
      </div>`
    }).join('')}
  </div>`
}

// ─── List ─────────────────────────────────────────────────────────────────────

function listSection(section) {
  const hasTableHeaders = section.contains.some(s => /\bcolumn header\b/i.test(s))
  if (hasTableHeaders) return dataTableSection(section)

  // Simple list with items
  return `<div style="display:flex;flex-direction:column">
    ${section.label ? `<div style="padding:12px 16px 4px">${sectionLabel(section.label)}</div>` : ''}
    ${section.contains.map((item, i) => {
      const parts = item.split(/\s*—\s*/)
      const primary = displayLabel(parts[0])
      const secondary = parts[1] ? displayLabel(parts[1]) : null
      const hasBadge = parts.some(p => /\bbadge\b/i.test(p))
      const hasChevron = /·\s*chevron\b/i.test(item)

      return `<div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
          <div class="sc-avatar sc-avatar--lg">${primary.slice(0, 2).toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500;color:var(--foreground);user-select:none;line-height:1.4">${primary}</div>
            ${secondary ? `<div style="font-size:13px;color:var(--muted-foreground);user-select:none;margin-top:1px">${secondary}</div>` : ''}
          </div>
          ${hasChevron || !hasBadge ? `<span style="color:var(--muted-foreground);flex-shrink:0">${icon('chevron-right', 16)}</span>` : ''}
        </div>
        ${i < section.contains.length - 1 ? `<div class="sc-separator" style="margin-left:68px"></div>` : ''}
      </div>`
    }).join('')}
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

  function renderStatusBadge(text) {
    const t = text.toLowerCase()
    if (/fulfilled|shipped|positive|resolved|active|completed|success/i.test(t)) {
      return `<span class="sc-badge sc-badge--success">${text}</span>`
    }
    if (/cancelled|refunded|failed|rejected|destructive/i.test(t)) {
      return `<span class="sc-badge sc-badge--destructive">${text}</span>`
    }
    if (/processing|pending|monitoring|warning/i.test(t)) {
      return `<span class="sc-badge sc-badge--warning">${text}</span>`
    }
    return `<span class="sc-badge">${text}</span>`
  }

  let html = '<div class="sc-card">'

  if (section.label) {
    html += `<div class="sc-card-header"><div class="sc-card-title">${section.label}</div></div>`
  }

  html += '<div class="sc-card-content" style="padding:0"><table class="sc-table">'

  if (cols.length > 0) {
    html += '<thead><tr>'
    cols.forEach(col => {
      html += `<th class="sc-th">${col}</th>`
    })
    html += '</tr></thead>'
  }

  html += '<tbody>'
  rows.forEach(row => {
    const cells = row.split(/\s*—\s*/).map(s => s.trim())
    html += '<tr>'
    cells.forEach((cell, ci) => {
      const c = cell.trim()
      const badgeMatch = c.match(/^(.+?)\s+badge$/i)
      let cellContent
      if (badgeMatch) {
        cellContent = renderStatusBadge(badgeMatch[1])
      } else if (/\blink\b$/i.test(c)) {
        const label = c.replace(/\s*link\s*$/i, '').trim() || 'View'
        cellContent = `<span style="font-size:14px;color:var(--chart-1);user-select:none">${label}</span>`
      } else {
        cellContent = `<span style="user-select:none">${c}</span>`
      }
      html += `<td class="sc-td">${cellContent}</td>`
    })
    html += '</tr>'
  })
  html += '</tbody></table></div>'

  if (pagination.length > 0) {
    html += `<div class="sc-card-footer" style="justify-content:space-between;padding:12px 24px;border-top:1px solid var(--border)">`
    pagination.forEach(item => {
      const isPageLabel = /\bpage\b/i.test(item) && !/\bbutton\b/i.test(item)
      if (isPageLabel) {
        html += `<span style="font-size:13px;color:var(--muted-foreground);user-select:none">${item}</span>`
      } else {
        html += `<button class="sc-btn sc-btn--outline sc-btn--xs">${item.replace(/\s*button\s*$/i, '').trim()}</button>`
      }
    })
    html += '</div>'
  }

  html += '</div>'
  return html
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

function gridSection(section) {
  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${section.label ? sectionLabel(section.label) : ''}
    <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px">
      ${section.contains.map(item => {
        const parts = item.split('—').map(s => s.trim())
        return `<div class="sc-card">
          <div class="sc-image-placeholder" style="height:140px;border-radius:0;aspect-ratio:auto"></div>
          <div class="sc-card-content" style="padding:12px 16px">
            <p style="font-size:14px;font-weight:500;color:var(--foreground);user-select:none">${displayLabel(parts[0])}</p>
            ${parts[1] ? `<p style="font-size:13px;color:var(--muted-foreground);user-select:none;margin-top:4px">${parts[1]}</p>` : ''}
          </div>
        </div>`
      }).join('')}
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

  return `<div style="display:flex;flex-direction:column;gap:16px;padding:24px 32px">
    <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      ${logo ? `<span class="sc-header-logo">${displayLabel(logo)}</span>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:20px">
        ${links.map(item => `<span style="font-size:13px;color:var(--muted-foreground);user-select:none">${item}</span>`).join('')}
      </div>
    </div>
    ${copyright ? `<div style="font-size:13px;color:var(--muted-foreground);opacity:0.6;user-select:none">${copyright}</div>` : ''}
  </div>`
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function emptyStateSection(section) {
  return `<div class="sc-empty">
    <div class="sc-empty-icon">${icon('inbox', 48)}</div>
    ${section.contains.map(item => {
      const type = classify(item)
      const text = displayLabel(item)
      if (type === 'headline') return `<div class="sc-empty-title">${text}</div>`
      if (type === 'subheadline' || type === 'text') return `<div class="sc-empty-description">${text}</div>`
      if (type.startsWith('btn')) return `<div class="sc-empty-action">${smartItem(item)}</div>`
      return smartItem(item)
    }).join('')}
  </div>`
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function bannerSection(section) {
  const items   = section.contains.filter(c => !classify(c).startsWith('btn'))
  const actions = section.contains.filter(c =>  classify(c).startsWith('btn'))

  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 24px;gap:16px">
    <div style="display:flex;flex-direction:column;gap:4px">
      ${items.map(item => `<span style="font-size:14px;color:var(--secondary-foreground);user-select:none">${displayLabel(item)}</span>`).join('')}
    </div>
    ${actions.length > 0 ? `<div style="display:flex;gap:8px;flex-shrink:0">${actions.map(item => smartItem(item)).join('')}</div>` : ''}
  </div>`
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function toolbarSection(section) {
  const isInput = (s) => /\binput\b|\btext field\b|\bsearch\b|\btype\b/i.test(s)

  return section.contains.map(item =>
    isInput(item)
      ? `<input class="sc-input" style="flex:1" placeholder="${displayLabel(item)}" readonly>`
      : `<span class="sc-btn sc-btn--ghost sc-btn--icon" title="${item}">${headerIcon(item)}</span>`
  ).join('')
}

// ─── Section Group ────────────────────────────────────────────────────────────

function sectionGroupSection(section) {
  return `<div>
    ${section.label ? `<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted-foreground);padding:12px 4px 8px;user-select:none">${section.label}</div>` : ''}
    <div class="sc-card">
      ${section.contains.map((item, i) => `<div>
        <div style="display:flex;align-items:center;padding:12px 16px">
          ${smartItem(item)}
        </div>
        ${i < section.contains.length - 1 ? `<div class="sc-separator"></div>` : ''}
      </div>`).join('')}
    </div>
  </div>`
}

// ─── Action Row ───────────────────────────────────────────────────────────────

function actionRowSection(section) {
  return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
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
    const count = section.contains.length
    const gridCols = count <= 2 ? 2 : count <= 3 ? 3 : 4

    return `<div style="display:grid;grid-template-columns:repeat(${gridCols}, 1fr);gap:16px">
      ${section.contains.map(item => {
        const { label, value, badge } = parseStatCard(item)
        const trend = badge.startsWith('+') ? 'up' : badge.startsWith('-') ? 'down' : 'neutral'

        return `<div class="sc-card">
          <div class="sc-card-content" style="padding:16px 20px">
            <div class="sc-stat-label">${label}</div>
            <div class="sc-stat-value" style="margin-top:4px">${value}</div>
            ${badge ? `<div class="sc-stat-change sc-stat-change--${trend}" style="margin-top:4px">${badge}</div>` : ''}
          </div>
        </div>`
      }).join('')}
    </div>`
  }

  // Simple stat blocks
  return `<div style="display:flex;border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
    ${section.contains.map((item, i) => {
      const { value, label } = parseStatCard(item)
      const borderRight = i < section.contains.length - 1 ? 'border-right:1px solid var(--border)' : ''

      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:20px;${borderRight}">
        <div class="sc-stat-value">${value}</div>
        <div class="sc-stat-label">${label}</div>
      </div>`
    }).join('')}
  </div>`
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function modalSection(section) {
  const actionItems = section.contains.filter(c => classify(c).startsWith('btn'))
  const bodyItems   = section.contains.filter(c => !classify(c).startsWith('btn'))

  return `<div style="width:100%;display:flex;align-items:center;justify-content:center">
    <div class="sc-card" style="width:85%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.12)">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)">
        <span style="font-size:16px;font-weight:600;color:var(--foreground);user-select:none">${section.label ?? 'Dialog'}</span>
        <span class="sc-btn sc-btn--ghost sc-btn--icon" style="width:28px;height:28px">${icon('x', 16)}</span>
      </div>
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        ${bodyItems.map(item => smartItem(item)).join('')}
      </div>
      ${actionItems.length > 0 ? `<div style="display:flex;gap:8px;padding:12px 20px 16px;justify-content:flex-end;border-top:1px solid var(--border)">
        ${actionItems.map(item => smartItem(item)).join('')}
      </div>` : ''}
    </div>
  </div>`
}

// ─── Loader / Splash ──────────────────────────────────────────────────────────

function loaderSection(section) {
  const desc = section.contains[0] ? displayLabel(section.contains[0]) : null

  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:80px 0">
    <div style="width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--foreground);border-radius:50%;animation:wf-loader-spin 0.8s linear infinite"></div>
    ${desc ? `<p style="font-size:14px;color:var(--muted-foreground);user-select:none;text-align:center;max-width:240px">${desc}</p>` : ''}
  </div>`
}

// ─── Map ──────────────────────────────────────────────────────────────────────

function mapSection(_section) {
  return `<div class="sc-image-placeholder" style="min-height:260px;border-radius:0;display:flex;align-items:center;justify-content:center;color:var(--muted-foreground)">
    ${icon('map-pin', 32)}
  </div>`
}

// ─── Floating Search ──────────────────────────────────────────────────────────

function floatingSearchSection(section) {
  const hasAvatar  = section.contains.some(s => /\bavatar\b/i.test(s))
  const searchItem = section.contains.find(s => !/\bavatar\b/i.test(s))

  return `<div style="display:flex;align-items:center;gap:8px;padding:12px 16px">
    <div style="flex:1;display:flex;align-items:center;gap:8px;background:var(--background);border:1px solid var(--border);border-radius:9999px;padding:8px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      ${icon('search', 14)}
      <span style="font-size:14px;color:var(--muted-foreground);user-select:none;flex:1">${displayLabel(searchItem ?? 'Search')}</span>
    </div>
    ${hasAvatar ? `<div class="sc-avatar">Me</div>` : ''}
  </div>`
}

// ─── Map Controls ─────────────────────────────────────────────────────────────

function mapControlsSection(section) {
  return `<div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;padding:8px 16px">
    ${section.contains.map(item => `<span class="sc-btn sc-btn--outline sc-btn--icon" style="border-radius:var(--radius);box-shadow:0 1px 3px rgba(0,0,0,0.06)" title="${item}">${headerIcon(item)}</span>`).join('')}
  </div>`
}

// ─── Category Strip ───────────────────────────────────────────────────────────

function categoryStripSection(section) {
  return `<div style="display:flex;align-items:center;gap:8px;overflow-x:auto;padding:12px 16px">
    ${section.contains.map((item, i) => `<span class="sc-badge${i === 0 ? '' : ' sc-badge--outline'}" style="white-space:nowrap;flex-shrink:0;padding:4px 14px">${item}</span>`).join('')}
  </div>`
}

// ─── Place List ───────────────────────────────────────────────────────────────

function placeListSection(section) {
  return `<div style="display:flex;flex-direction:column">
    ${section.label ? `<div style="padding:12px 16px 4px">${sectionLabel(section.label)}</div>` : ''}
    ${section.contains.map((item, i) => {
      const parts = item.split('—').map(s => s.trim())
      const name = parts[0]
      const distance = parts[1] || null

      return `<div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
          <div style="width:40px;height:40px;border-radius:var(--radius);background:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted-foreground)">
            ${icon('map-pin', 16)}
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500;color:var(--foreground);user-select:none">${name}</div>
            ${distance ? `<div style="font-size:13px;color:var(--muted-foreground);user-select:none;margin-top:2px">${distance}</div>` : ''}
          </div>
          <span style="color:var(--muted-foreground);flex-shrink:0">${icon('chevron-right', 16)}</span>
        </div>
        ${i < section.contains.length - 1 ? `<div class="sc-separator" style="margin-left:68px"></div>` : ''}
      </div>`
    }).join('')}
  </div>`
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function tabsSection(section) {
  return `<div class="sc-tabs">
    ${section.contains.map((item, i) => `<div class="sc-tab${i === 0 ? ' sc-tab--active' : ''}">${item}</div>`).join('')}
  </div>`
}

// ─── Feature Section (card-row, feature-grid, feature-list) ───────────────────

function featureSection(section) {
  const isGrid = section.layout === 'grid' || section.type === 'feature-grid'

  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${section.label ? sectionLabel(section.label) : ''}
    <div style="display:${isGrid ? 'grid' : 'flex'};${isGrid ? 'grid-template-columns:repeat(2, 1fr)' : 'flex-direction:column'};gap:12px">
      ${section.contains.map(item => {
        const parts = item.split('—').map(s => s.trim())
        const title = parts[0]
        const desc  = parts[1] || null

        return `<div class="sc-card">
          <div class="sc-card-content" style="display:flex;align-items:flex-start;gap:12px;padding:16px">
            <div style="width:36px;height:36px;border-radius:var(--radius);background:var(--muted);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted-foreground)">
              ${headerIcon(title)}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
              <span style="font-size:14px;font-weight:500;color:var(--foreground);user-select:none">${title}</span>
              ${desc ? `<span style="font-size:13px;color:var(--muted-foreground);user-select:none;line-height:1.4">${desc}</span>` : ''}
            </div>
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
  const lineItems = contains.filter(s => /\bline\s*—\s*(blue|violet|green|red|orange|purple|gray|grey)/i.test(s))

  const tabs = tabItems.length > 0 ? `<div class="sc-tab-pills">
    ${tabItems.map(tab => {
      const label = tab.replace(/\s*selector\s+tab\s*/i, '').replace(/\s*\bactive\b\s*/i, '').trim()
      const isActive = /\bactive\b/i.test(tab)
      return `<span class="sc-tab-pill${isActive ? ' sc-tab-pill--active' : ''}">${label}</span>`
    }).join('')}
  </div>` : ''

  const chart = isLine
    ? lineChartViz(axisLabels, lineItems)
    : barChartViz()

  return `<div class="sc-card">
    <div class="sc-card-header sc-card-header--row">
      <div>
        ${section.label ? `<div class="sc-card-title">${section.label}</div>` : ''}
      </div>
      ${tabs}
    </div>
    <div class="sc-card-content">
      ${chart}
    </div>
    ${lineItems.length > 0 ? `<div class="sc-card-footer" style="padding-top:0">
      ${lineItems.map(item => {
        const name = item.split(/\s*—\s*/)[0]?.replace(/\s*line\s*/i, '').trim() ?? item
        const colorMatch = item.match(/—\s*(blue|violet|green|red|orange|purple|gray|grey)/i)
        const colorName = colorMatch?.[1]?.toLowerCase() ?? 'blue'
        const colorMap = { blue: 'var(--chart-1)', green: 'var(--chart-2)', orange: 'var(--chart-3)', red: 'var(--chart-4)', violet: 'var(--chart-5)', purple: 'var(--chart-5)', gray: 'var(--muted-foreground)', grey: 'var(--muted-foreground)' }
        const color = colorMap[colorName] || 'var(--chart-1)'
        return `<div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:3px;border-radius:2px;background:${color}"></div><span style="font-size:12px;color:var(--muted-foreground);user-select:none">${name}</span></div>`
      }).join('')}
    </div>` : ''}
  </div>`
}

function lineChartViz(axisLabels, lineItems) {
  const W = 500, H = 200, px = 16, py = 20
  const blueData   = [38, 52, 45, 63, 58, 74]
  const violetData = [28, 34, 41, 36, 45, 50]
  const n = blueData.length

  const toX = (i) => px + (i / (n - 1)) * (W - px * 2)
  const toY = (v) => py + (1 - (v - 20) / 60) * (H - py * 2)
  const pathD = (d) => d.map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const areaD = (d) =>
    `${pathD(d)} L${toX(n - 1).toFixed(1)},${(H - py).toFixed(1)} L${toX(0).toFixed(1)},${(H - py).toFixed(1)} Z`

  const colorMap = { blue: 'var(--chart-1)', green: 'var(--chart-2)', orange: 'var(--chart-3)', red: 'var(--chart-4)', violet: 'var(--chart-5)', purple: 'var(--chart-5)', gray: '#71717a', grey: '#71717a' }

  const seriesColors = lineItems.map(item => {
    const match = item.match(/—\s*(blue|violet|green|red|orange|purple|gray|grey)/i)
    const name = match?.[1]?.toLowerCase() ?? 'blue'
    return colorMap[name] || 'var(--chart-1)'
  })

  const allData = [blueData, violetData]

  let svgContent = ''

  // Grid lines
  ;[0.25, 0.5, 0.75].forEach(p => {
    const y = py + p * (H - py * 2)
    svgContent += `<line x1="${px}" y1="${y.toFixed(1)}" x2="${W - px}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.6"/>`
  })

  // Baseline
  svgContent += `<line x1="${px}" y1="${H - py}" x2="${W - px}" y2="${H - py}" stroke="var(--border)" stroke-width="1"/>`

  // Areas + lines
  allData.forEach((d, si) => {
    const color = seriesColors[si] ?? 'var(--chart-1)'
    svgContent += `<path d="${areaD(d)}" fill="${color}" fill-opacity="0.08"/>`
    svgContent += `<path d="${pathD(d)}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    // Dots
    d.forEach((v, i) => {
      svgContent += `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3" fill="var(--background)" stroke="${color}" stroke-width="2"/>`
    })
  })

  // Axis labels
  if (axisLabels) {
    axisLabels.slice(0, n).forEach((label, i) => {
      svgContent += `<text x="${toX(i).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="11" font-family="-apple-system, BlinkMacSystemFont, sans-serif" fill="var(--muted-foreground)" style="user-select:none">${label}</text>`
    })
  }

  return `<div style="width:100%"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${svgContent}</svg></div>`
}

function barChartViz() {
  const bars = [65, 45, 80, 55, 70, 40, 75]
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const W = 500, H = 200, px = 16, py = 20
  const barW = 36
  const gap = (W - px * 2 - barW * bars.length) / (bars.length - 1)

  let svgContent = ''

  // Grid lines
  ;[0.25, 0.5, 0.75].forEach(p => {
    const y = py + p * (H - py * 2)
    svgContent += `<line x1="${px}" y1="${y.toFixed(1)}" x2="${W - px}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="1" opacity="0.6"/>`
  })
  svgContent += `<line x1="${px}" y1="${H - py}" x2="${W - px}" y2="${H - py}" stroke="var(--border)" stroke-width="1"/>`

  // Bars
  bars.forEach((h, i) => {
    const x = px + i * (barW + gap)
    const barH = (h / 100) * (H - py * 2)
    const y = H - py - barH
    svgContent += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${barH.toFixed(1)}" rx="4" fill="var(--chart-1)" opacity="0.85"/>`
    svgContent += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="11" font-family="-apple-system, BlinkMacSystemFont, sans-serif" fill="var(--muted-foreground)" style="user-select:none">${labels[i] || ''}</text>`
  })

  return `<div style="width:100%"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${svgContent}</svg></div>`
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function onboardingSection(section) {
  const stepItems = section.contains.filter(s => !classify(s).startsWith('btn'))
  const btnItems  = section.contains.filter(s =>  classify(s).startsWith('btn'))

  return `<div style="display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;padding:40px 20px">
    <div class="sc-image-placeholder" style="width:96px;height:96px;border-radius:16px;aspect-ratio:auto"></div>
    <div style="display:flex;flex-direction:column;gap:8px;max-width:280px">
      ${stepItems.map(item => {
        if (classify(item) === 'headline') return `<h2 style="font-size:20px;font-weight:600;color:var(--foreground);user-select:none">${displayLabel(item)}</h2>`
        return smartItem(item)
      }).join('')}
    </div>
    ${btnItems.length > 0 ? `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;width:100%;max-width:280px">
      ${btnItems.map(item => `<div style="width:100%">${smartItem(item)}</div>`).join('')}
    </div>` : ''}
    <div style="display:flex;gap:6px">
      <div style="height:8px;width:20px;border-radius:9999px;background:var(--primary)"></div>
      <div style="height:8px;width:8px;border-radius:9999px;background:var(--border)"></div>
      <div style="height:8px;width:8px;border-radius:9999px;background:var(--border)"></div>
    </div>
  </div>`
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function pricingSection(section) {
  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${section.label ? sectionLabel(section.label) : ''}
    <div style="display:grid;grid-template-columns:repeat(${Math.min(section.contains.length, 3)}, 1fr);gap:16px">
      ${section.contains.map((item, i) => {
        const parts = item.split('—').map(s => s.trim())
        const name = parts[0]
        const price = parts[1] || null
        const featured = i === 1

        return `<div class="sc-card" style="${featured ? 'border-color:var(--primary);box-shadow:0 2px 8px rgba(0,0,0,0.1)' : ''}">
          <div class="sc-card-header">
            <div class="sc-card-description" style="text-transform:uppercase;font-size:12px;font-weight:600;letter-spacing:0.05em">${name}</div>
            ${price ? `<div style="font-size:30px;font-weight:700;color:var(--foreground);letter-spacing:-0.02em;margin-top:4px">${price}</div>` : ''}
          </div>
          <div class="sc-card-content">
            <div style="display:flex;flex-direction:column;gap:8px">
              <div style="height:8px;border-radius:4px;background:var(--muted);width:85%"></div>
              <div style="height:8px;border-radius:4px;background:var(--muted);width:70%"></div>
              <div style="height:8px;border-radius:4px;background:var(--muted);width:55%"></div>
            </div>
          </div>
          <div class="sc-card-footer">
            <button class="sc-btn${featured ? '' : ' sc-btn--outline'}" style="width:100%">Get started</button>
          </div>
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ─── Testimonial ──────────────────────────────────────────────────────────────

function testimonialSection(section) {
  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${section.label ? sectionLabel(section.label) : ''}
    ${section.contains.map(item => {
      const parts = item.split('—').map(s => s.trim())
      const quote  = parts[0]
      const author = parts[1] || null

      return `<div class="sc-card">
        <div class="sc-card-content">
          <div style="display:flex;flex-direction:column;gap:12px">
            ${quote ? `<p style="font-size:14px;color:var(--foreground);line-height:1.6;font-style:italic;user-select:none">"${quote}"</p>` : ''}
            ${author ? `<div style="display:flex;align-items:center;gap:8px">
              <div class="sc-avatar">${author.slice(0, 2).toUpperCase()}</div>
              <span style="font-size:13px;font-weight:500;color:var(--foreground);user-select:none">${author}</span>
            </div>` : ''}
          </div>
        </div>
      </div>`
    }).join('')}
  </div>`
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

function gallerySection(section) {
  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${section.label ? sectionLabel(section.label) : ''}
    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px">
      ${section.contains.map(() => `<div class="sc-image-placeholder" style="aspect-ratio:1;border-radius:var(--radius)"></div>`).join('')}
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
    return `<div style="display:flex;flex-direction:column;gap:8px;width:100%;padding:16px">
      ${section.label ? sectionLabel(section.label) : ''}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${items.map(item => `<span class="sc-badge">${displayLabel(item)}</span>`).join('')}
      </div>
    </div>`
  }

  if (isDetailList) {
    return `<div style="display:flex;flex-direction:column;gap:8px;width:100%;padding:0 16px">
      ${section.label ? sectionLabel(section.label) : ''}
      <div class="sc-card">
        ${items.map((item, i) => {
          const parts = item.split('—').map(s => s.trim())
          const name = parts[0]
          const detail = parts[1] || null

          return `<div>
            <div style="display:flex;align-items:center;gap:12px;padding:12px 16px">
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;color:var(--foreground);user-select:none">${name}</div>
                ${detail ? `<div style="font-size:13px;color:var(--muted-foreground);user-select:none;margin-top:2px">${detail}</div>` : ''}
              </div>
              <span style="color:var(--muted-foreground);flex-shrink:0">${icon('chevron-right', 16)}</span>
            </div>
            ${i < items.length - 1 ? `<div class="sc-separator"></div>` : ''}
          </div>`
        }).join('')}
      </div>
    </div>`
  }

  if (isNav) {
    return `<div style="display:flex;flex-direction:column;gap:8px;width:100%;padding:16px">
      ${section.label ? sectionLabel(section.label) : ''}
      <nav class="sc-nav" style="flex-wrap:wrap">
        ${items.map((item, i) => `<span class="sc-nav-item${i === 0 ? ' sc-nav-item--active' : ''}">${item}</span>`).join('')}
      </nav>
    </div>`
  }

  // Default: stack of smart items
  return `<div style="display:flex;flex-direction:column;gap:8px;width:100%;padding:16px">
    ${section.label ? sectionLabel(section.label) : ''}
    ${items.map(item => smartItem(item)).join('')}
  </div>`
}
