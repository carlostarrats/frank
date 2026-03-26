// Frank — Screen renderer: layout engine + device frame wrapper
// Returns HTML strings (no framework — wireframes are static content)

import { renderSection } from './sections.js'

export const PLATFORM_DEFAULTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  web: { width: 1440, height: 900 },
};

const CHROME = new Set(['header', 'top-nav', 'toolbar', 'bottom-nav', 'banner'])

export function renderScreen(schema) {
  if (!schema || !schema.sections) return '<div></div>'

  const platform = schema.platform || 'mobile'
  const deviceClass = (platform === 'ios' || platform === 'android') ? 'mobile'
    : platform === 'tablet' ? 'tablet'
    : platform === 'web' ? 'web'
    : 'mobile'

  const viewport = schema.viewport || PLATFORM_DEFAULTS[deviceClass] || PLATFORM_DEFAULTS.web;

  // Check if this is a web layout with sidebar
  const hasSidebar = deviceClass === 'web' && schema.sections.some(s => s.type === 'sidebar')

  if (hasSidebar) {
    return renderWebLayout(schema, viewport, deviceClass)
  }

  // Standard stacked layout (mobile, tablet, or web without sidebar)
  return renderStackedLayout(schema, viewport, deviceClass)
}

function renderWebLayout(schema, viewport, deviceClass) {
  const sidebarSection = schema.sections.find(s => s.type === 'sidebar')
  const headerSection = schema.sections.find(s => s.type === 'header' || s.type === 'top-nav')
  const otherSections = schema.sections.filter(s => s.type !== 'sidebar' && s.type !== 'header' && s.type !== 'top-nav')

  const sidebarHtml = sidebarSection
    ? renderSection(sidebarSection, schema.label, 'web')
    : ''

  const headerHtml = headerSection
    ? `<div class="sc-page-header">${renderSection(headerSection, schema.label, 'web')}</div>`
    : ''

  const contentHtml = otherSections.map(section => {
    const content = renderSection(section, schema.label, 'web')
    return `<div class="wf-section wf-section--${section.type}">${content}</div>`
  }).join('')

  return `<div class="wireframe"><div class="wf-device wf-device--${deviceClass}" style="width:${viewport.width}px;min-height:${viewport.height}px">
    <div class="sc-layout">
      <aside class="wf-section wf-section--sidebar">${sidebarHtml}</aside>
      <main class="sc-main">
        ${headerHtml}
        <div class="sc-page-content">${contentHtml}</div>
      </main>
    </div>
  </div></div>`
}

function renderStackedLayout(schema, viewport, deviceClass) {
  const hasChrome = deviceClass !== 'web' && schema.sections.some(s => CHROME.has(s.type))
  const fillIdx = hasChrome ? schema.sections.findIndex(s => !CHROME.has(s.type)) : -1

  const sectionHtml = schema.sections.map((section, i) => {
    const isFill = i === fillIdx
    const fillStyle = isFill ? 'style="flex:1 1 0;min-height:0;display:flex;flex-direction:column"' : ''
    const content = renderSection(section, schema.label, schema.platform || 'mobile')
    return `<div ${fillStyle} class="wf-section wf-section--${section.type}">${content}</div>`
  }).join('')

  return `<div class="wireframe"><div class="wf-device wf-device--${deviceClass}" style="width:${viewport.width}px;min-height:${viewport.height}px">${sectionHtml}</div></div>`
}
