// Looky Loo Schema — v1
// This is the single source of truth. The panel and all exports consume this schema.
// Never render without a validated schema. Never export from a different representation.

export const SCHEMA_VERSION = 'v1' as const;

// ─── Design Tokens ────────────────────────────────────────────────────────────
// Auto-injected by the daemon when a schema is received.
// Exact values so any downstream tool (Figma MCP, Linear, etc.) can reconstruct
// the design without guessing.

export interface DesignTokens {
  colors: Record<string, string>;
  typography: Record<string, {
    size: number;
    weight: number;
    lineHeight: number;
    family: string;
  }>;
  spacing: Record<string, number>;
  components: Record<string, number | string>;
}

// ─── Primitives ───────────────────────────────────────────────────────────────

export const PLATFORMS = ['mobile', 'web', 'tablet', 'ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

// Built-in types get dedicated high-fidelity renderers.
// Any other string is valid — the renderer falls back to a generic layout.
export const SECTION_TYPES = [
  'header', 'hero', 'content', 'top-nav', 'bottom-nav', 'sidebar',
  'form', 'list', 'grid', 'footer', 'empty-state', 'banner', 'toolbar', 'modal',
] as const;
export type SectionType = string;

export const SPACINGS = ['compact', 'comfortable', 'spacious'] as const;
export type Spacing = (typeof SPACINGS)[number];

export const NAV_POSITIONS = ['top', 'bottom', 'sidebar', 'none'] as const;
export type NavPosition = (typeof NAV_POSITIONS)[number];

export const HEADER_STYLES = ['minimal', 'prominent', 'none'] as const;
export type HeaderStyle = (typeof HEADER_STYLES)[number];

export const LAYOUTS = ['row', 'column', 'grid'] as const;
export type Layout = (typeof LAYOUTS)[number];

// ─── Section ─────────────────────────────────────────────────────────────────

export interface Section {
  /** Section type — built-in types get dedicated renderers; any other string gets a generic layout */
  type: SectionType;
  /** Optional override label for display in the wireframe (e.g. "Featured Items") */
  label?: string;
  /** Descriptive list of elements this section contains (e.g. ["logo", "nav links", "user avatar"]) */
  contains: string[];
  /** How contained elements are arranged */
  layout?: Layout;
  /** Freeform annotation — designer/Claude notes visible in the wireframe */
  note?: string;
}

// ─── Design Language ─────────────────────────────────────────────────────────
// Applied at the flow level. All screens in a flow inherit from this.
// This is what keeps a 4-screen onboarding flow visually coherent.

export interface DesignLanguage {
  nav_position?: NavPosition;
  header_style?: HeaderStyle;
  /** Descriptive card style (e.g. "rounded-lg shadow-sm", "flat border") */
  card_style?: string;
  spacing?: Spacing;
  /** Broad color intent — not a specific color, just a direction */
  color_scheme?: 'light' | 'dark' | 'neutral';
}

// ─── Single Screen ────────────────────────────────────────────────────────────

export interface ScreenSchema {
  schema: typeof SCHEMA_VERSION;
  type: 'screen';
  label: string;
  /** ISO 8601 timestamp of when this render was generated */
  timestamp: string;
  platform: Platform;
  /** Auto-injected by daemon — exact design tokens for downstream tools */
  tokens?: DesignTokens;
  sections: Section[];
}

// ─── Multi-Screen Flow ────────────────────────────────────────────────────────

export interface FlowScreen {
  label: string;
  /** Overrides the flow-level platform for this screen only */
  platform?: Platform;
  sections: Section[];
}

export interface FlowSchema {
  schema: typeof SCHEMA_VERSION;
  type: 'flow';
  label: string;
  /** ISO 8601 timestamp of when this flow was generated */
  timestamp: string;
  /** Default platform for all screens in this flow */
  platform: Platform;
  /** Shared design language — inherited by all screens */
  design_language: DesignLanguage;
  /** Auto-injected by daemon — exact design tokens for downstream tools */
  tokens?: DesignTokens;
  screens: FlowScreen[];
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type LookyLooSchema = ScreenSchema | FlowSchema;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isScreenSchema(schema: LookyLooSchema): schema is ScreenSchema {
  return schema.type === 'screen';
}

export function isFlowSchema(schema: LookyLooSchema): schema is FlowSchema {
  return schema.type === 'flow';
}
