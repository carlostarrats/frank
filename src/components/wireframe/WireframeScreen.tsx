import type { ScreenSchema, Platform, DesignTokens } from '../../schema/types';
import { WireframeSection } from './WireframeSection';
import './WireframeScreen.css';

interface Props {
  schema: ScreenSchema;
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

export function WireframeScreen({ schema }: Props) {
  const tokenStyle = schema.tokens ? tokensToCssVars(schema.tokens) : {};
  return (
    <div className="wireframe" style={tokenStyle}>
      <WireframeDevice platform={schema.platform}>
        {schema.sections.map((section, i) => (
          <WireframeSection key={i} section={section} screenLabel={schema.label} platform={schema.platform} />
        ))}
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
  // Normalise platform aliases to CSS class names
  const cls =
    platform === 'ios' || platform === 'android' ? 'mobile'
    : platform === 'tablet' ? 'tablet'
    : platform === 'web'    ? 'web'
    : 'mobile'; // safe default
  return (
    <div className={`wf-device wf-device--${cls}`}>
      {children}
    </div>
  );
}
