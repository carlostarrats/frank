// Frank — Screen renderer: device frame wrapper + section routing
// Returns HTML strings (no ArrowJS — wireframes are static content)

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

  const hasChrome = platform !== 'web' && schema.sections.some(s => CHROME.has(s.type))
  const fillIdx = hasChrome ? schema.sections.findIndex(s => !CHROME.has(s.type)) : -1

  const sectionHtml = schema.sections.map((section, i) => {
    const isFill = i === fillIdx
    const fillStyle = isFill ? 'style="flex:1 1 0;min-height:0;display:flex;flex-direction:column"' : ''
    const content = renderSection(section, schema.label, platform)
    return `<div ${fillStyle} class="wf-section wf-section--${section.type}">${content}</div>`
  }).join('')

  return `<div class="wireframe"><div class="wf-device wf-device--${deviceClass}" style="width:${viewport.width}px;min-height:${viewport.height}px">${sectionHtml}</div></div>`
}
