// Frank Schema Validator — v1
// Ported from TypeScript src/schema/validate.ts + src/schema/types.ts

// ─── Constants ───────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 'v1'
export const PLATFORMS = ['mobile', 'web', 'tablet', 'ios', 'android']
export const SPACINGS = ['compact', 'comfortable', 'spacious']
export const NAV_POSITIONS = ['top', 'bottom', 'sidebar', 'none']
export const HEADER_STYLES = ['minimal', 'prominent', 'none']
export const LAYOUTS = ['row', 'column', 'grid']

// ─── Public entry point ──────────────────────────────────────────────────────

export function validateSchema(raw) {
  if (!isObject(raw)) {
    return fail('Schema must be a JSON object')
  }

  if (raw.schema !== SCHEMA_VERSION) {
    return fail(`Unsupported schema version: "${raw.schema}". Expected "${SCHEMA_VERSION}"`)
  }

  if (raw.type === 'screen') return validateScreenSchema(raw)
  if (raw.type === 'flow') return validateFlowSchema(raw)

  return fail(`Unknown schema type: "${raw.type}". Expected "screen" or "flow"`)
}

// ─── Screen ──────────────────────────────────────────────────────────────────

function validateScreenSchema(raw) {
  const label = requireString(raw, 'label')
  if (!label.ok) return fail(label.error)

  const timestamp = requireString(raw, 'timestamp')
  if (!timestamp.ok) return fail(timestamp.error)

  const platform = requireEnum(raw, 'platform', PLATFORMS)
  if (!platform.ok) return fail(platform.error)

  const sections = requireSections(raw, 'sections')
  if (!sections.ok) return fail(sections.error)

  return {
    valid: true,
    schema: {
      schema: SCHEMA_VERSION,
      type: 'screen',
      label: label.value,
      timestamp: timestamp.value,
      platform: platform.value,
      ...(isObject(raw.tokens) && { tokens: raw.tokens }),
      sections: sections.value,
    },
  }
}

// ─── Flow ────────────────────────────────────────────────────────────────────

function validateFlowSchema(raw) {
  const label = requireString(raw, 'label')
  if (!label.ok) return fail(label.error)

  const timestamp = requireString(raw, 'timestamp')
  if (!timestamp.ok) return fail(timestamp.error)

  const platform = requireEnum(raw, 'platform', PLATFORMS)
  if (!platform.ok) return fail(platform.error)

  const designLanguage = validateDesignLanguage(raw)
  if (!designLanguage.ok) return fail(designLanguage.error)

  const screens = validateFlowScreens(raw)
  if (!screens.ok) return fail(screens.error)

  if (screens.value.length === 0) {
    return fail('Flow must contain at least one screen')
  }

  return {
    valid: true,
    schema: {
      schema: SCHEMA_VERSION,
      type: 'flow',
      label: label.value,
      timestamp: timestamp.value,
      platform: platform.value,
      design_language: designLanguage.value,
      ...(isObject(raw.tokens) && { tokens: raw.tokens }),
      screens: screens.value,
    },
  }
}

// ─── Field validators ────────────────────────────────────────────────────────

function requireString(obj, key) {
  if (typeof obj[key] !== 'string' || obj[key].trim() === '') {
    return { ok: false, error: `"${key}" must be a non-empty string` }
  }
  return { ok: true, value: obj[key] }
}

function requireEnum(obj, key, allowed) {
  if (!allowed.includes(obj[key])) {
    return {
      ok: false,
      error: `"${key}" must be one of: ${allowed.join(', ')}. Got: "${obj[key]}"`,
    }
  }
  return { ok: true, value: obj[key] }
}

function requireSections(obj, key) {
  if (!Array.isArray(obj[key])) {
    return { ok: false, error: `"${key}" must be an array` }
  }
  if (obj[key].length === 0) {
    return { ok: false, error: `"${key}" must contain at least one section` }
  }

  const sections = []
  for (let i = 0; i < obj[key].length; i++) {
    const result = validateSection(obj[key][i], i)
    if (!result.ok) return { ok: false, error: result.error }
    sections.push(result.value)
  }
  return { ok: true, value: sections }
}

function validateSection(raw, index) {
  const prefix = `sections[${index}]`
  if (!isObject(raw)) return { ok: false, error: `${prefix} must be an object` }

  if (typeof raw.type !== 'string' || raw.type.trim() === '') {
    return { ok: false, error: `${prefix}.type must be a non-empty string` }
  }

  if (!Array.isArray(raw.contains)) {
    return { ok: false, error: `${prefix}.contains must be an array` }
  }

  for (let i = 0; i < raw.contains.length; i++) {
    if (typeof raw.contains[i] !== 'string') {
      return { ok: false, error: `${prefix}.contains[${i}] must be a string` }
    }
  }

  if (raw.layout !== undefined && !LAYOUTS.includes(raw.layout)) {
    return { ok: false, error: `${prefix}.layout must be one of: ${LAYOUTS.join(', ')}` }
  }

  if (raw.label !== undefined && typeof raw.label !== 'string') {
    return { ok: false, error: `${prefix}.label must be a string` }
  }

  if (raw.note !== undefined && typeof raw.note !== 'string') {
    return { ok: false, error: `${prefix}.note must be a string` }
  }

  return {
    ok: true,
    value: {
      type: raw.type,
      contains: raw.contains,
      ...(raw.label !== undefined && { label: raw.label }),
      ...(raw.layout !== undefined && { layout: raw.layout }),
      ...(raw.note !== undefined && { note: raw.note }),
      ...(raw.navigatesTo !== undefined && { navigatesTo: raw.navigatesTo }),
    },
  }
}

function validateDesignLanguage(obj) {
  const raw = obj.design_language
  if (raw === undefined || raw === null) {
    return { ok: true, value: {} }
  }
  if (!isObject(raw)) {
    return { ok: false, error: '"design_language" must be an object' }
  }

  const COLOR_SCHEMES = ['light', 'dark', 'neutral']

  if (raw.nav_position !== undefined && !NAV_POSITIONS.includes(raw.nav_position)) {
    return { ok: false, error: `"design_language.nav_position" must be one of: ${NAV_POSITIONS.join(', ')}` }
  }
  if (raw.header_style !== undefined && !HEADER_STYLES.includes(raw.header_style)) {
    return { ok: false, error: `"design_language.header_style" must be one of: ${HEADER_STYLES.join(', ')}` }
  }
  if (raw.spacing !== undefined && !SPACINGS.includes(raw.spacing)) {
    return { ok: false, error: `"design_language.spacing" must be one of: ${SPACINGS.join(', ')}` }
  }
  if (raw.color_scheme !== undefined && !COLOR_SCHEMES.includes(raw.color_scheme)) {
    return { ok: false, error: `"design_language.color_scheme" must be one of: ${COLOR_SCHEMES.join(', ')}` }
  }

  return {
    ok: true,
    value: {
      ...(raw.nav_position !== undefined && { nav_position: raw.nav_position }),
      ...(raw.header_style !== undefined && { header_style: raw.header_style }),
      ...(raw.card_style !== undefined && { card_style: raw.card_style }),
      ...(raw.spacing !== undefined && { spacing: raw.spacing }),
      ...(raw.color_scheme !== undefined && { color_scheme: raw.color_scheme }),
    },
  }
}

function validateFlowScreens(obj) {
  if (!Array.isArray(obj.screens)) {
    return { ok: false, error: '"screens" must be an array' }
  }

  const screens = []
  for (let i = 0; i < obj.screens.length; i++) {
    const result = validateFlowScreen(obj.screens[i], i)
    if (!result.ok) return { ok: false, error: result.error }
    screens.push(result.value)
  }
  return { ok: true, value: screens }
}

function validateFlowScreen(raw, index) {
  const prefix = `screens[${index}]`
  if (!isObject(raw)) return { ok: false, error: `${prefix} must be an object` }

  if (typeof raw.label !== 'string' || raw.label.trim() === '') {
    return { ok: false, error: `${prefix}.label must be a non-empty string` }
  }

  if (raw.platform !== undefined && !PLATFORMS.includes(raw.platform)) {
    return { ok: false, error: `${prefix}.platform must be one of: ${PLATFORMS.join(', ')}` }
  }

  const sections = requireSections(raw, 'sections')
  if (!sections.ok) return { ok: false, error: `${prefix}.${sections.error}` }

  return {
    ok: true,
    value: {
      label: raw.label,
      ...(raw.platform !== undefined && { platform: raw.platform }),
      sections: sections.value,
    },
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function isObject(val) {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function fail(message) {
  return { valid: false, error: message }
}
