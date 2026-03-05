import { useRef } from 'react';
import { motion } from 'framer-motion';
import type { ScreenSchema, Platform, DesignTokens } from '../../schema/types';
import { WireframeSection } from './WireframeSection';
import './WireframeScreen.css';

interface Props {
  schema: ScreenSchema;
  onNavigate?: (screenLabel: string) => void;
  editMode?: boolean;
  onSectionClick?: (sectionIndex: number) => void;
}

function tokensToCssVars(tokens: DesignTokens): React.CSSProperties {
  const c = tokens.colors ?? {};
  return {
    '--wf-bg':           c['background']         ?? undefined,
    '--wf-muted':        c['muted']               ?? c['secondary']  ?? undefined,
    '--wf-border':       c['border']              ?? undefined,
    '--wf-text':         c['foreground']          ?? undefined,
    '--wf-text-muted':   c['muted-foreground']    ?? undefined,
    '--wf-primary':      c['primary']             ?? undefined,
    '--wf-primary-fg':   c['primary-foreground']  ?? undefined,
    '--wf-accent':       c['accent']              ?? undefined,
    '--wf-accent-muted': c['accent-foreground']   ?? undefined,
  } as React.CSSProperties;
}

// Stagger cap: after 5 sections, all remaining sections share the max delay (0.15s)
const MAX_STAGGER_SECTION = 5;

// Chrome sections have fixed heights; everything else can fill remaining space.
const CHROME = new Set(['header', 'top-nav', 'toolbar', 'bottom-nav', 'banner']);

export function WireframeScreen({ schema, onNavigate, editMode, onSectionClick }: Props) {
  const tokenStyle = schema.tokens ? tokensToCssVars(schema.tokens) : {};
  const hasAnimated = useRef(false);
  const shouldAnimate = !hasAnimated.current;
  if (shouldAnimate) hasAnimated.current = true;

  // The first non-chrome section fills remaining device height when chrome sections exist.
  // This models how real mobile screens work: header + scrollable content + toolbar.
  const hasChrome = schema.sections.some(s => CHROME.has(s.type));
  const fillIdx   = hasChrome ? schema.sections.findIndex(s => !CHROME.has(s.type)) : -1;

  return (
    <div className="wireframe" style={tokenStyle}>
      <WireframeDevice platform={schema.platform}>
        {schema.sections.map((section, i) => {
          const delay   = shouldAnimate ? Math.min(i, MAX_STAGGER_SECTION) * 0.02 : 0;
          const isFill  = i === fillIdx;
          return (
            <motion.div
              key={i}
              initial={shouldAnimate ? { opacity: 0, y: 4 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay, duration: 0.07, ease: 'easeOut' }}
              style={isFill ? { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}
            >
              <WireframeSection
                section={section}
                screenLabel={schema.label}
                platform={schema.platform}
                onNavigate={onNavigate}
                editMode={editMode}
                onSectionClick={onSectionClick ? () => onSectionClick(i) : undefined}
                fill={isFill}
              />
            </motion.div>
          );
        })}
      </WireframeDevice>
    </div>
  );
}

function WireframeDevice({
  platform,
  children,
}: {
  platform: Platform;
  children: React.ReactNode;
}) {
  const cls =
    platform === 'ios' || platform === 'android' ? 'mobile'
    : platform === 'tablet' ? 'tablet'
    : platform === 'web'    ? 'web'
    : 'mobile';
  return (
    <div className={`wf-device wf-device--${cls}`}>
      {children}
    </div>
  );
}
