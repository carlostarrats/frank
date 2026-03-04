import type { ScreenSchema, Platform } from '../../schema/types';
import { WireframeSection } from './WireframeSection';
import './WireframeScreen.css';

interface Props {
  schema: ScreenSchema;
}

export function WireframeScreen({ schema }: Props) {
  return (
    <div className="wireframe">
      <WireframeDevice platform={schema.platform}>
        {schema.sections.map((section, i) => (
          <WireframeSection key={i} section={section} />
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
  return (
    <div className={`wf-device wf-device--${platform}`}>
      {children}
    </div>
  );
}
