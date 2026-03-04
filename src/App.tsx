import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useDaemonSocket } from './hooks/useDaemonSocket';
import { useTabs } from './hooks/useTabs';
import { validateSchema } from './schema/validate';
import { isScreenSchema, isFlowSchema } from './schema/types';
import type { ScreenSchema } from './schema/types';
import { SkeletonScreen } from './components/SkeletonScreen';
import { WireframeScreen } from './components/wireframe/WireframeScreen';
import { exportToPng } from './exports/png';
import { copyAsContext } from './exports/context';
import type { PanelMessage } from './types/messages';
import type { Tab } from './hooks/useTabs';
import './App.css';

const IDLE_PHRASES = ['Watching.', 'Ready.', 'On deck.', 'Listening.', 'Standing by.'];

function useIdlePhrase() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % IDLE_PHRASES.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);
  return IDLE_PHRASES[index];
}

export default function App() {
  const idlePhrase = useIdlePhrase();
  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, clearTabs } = useTabs();

  const handleMessage = useCallback(
    (msg: PanelMessage) => {
      if (msg.type === 'clear') {
        clearTabs();
        return;
      }

      const result = validateSchema(msg.schema);
      if (!result.valid) {
        console.warn('[lookyloo] invalid schema received:', result.error);
        return;
      }

      if (isFlowSchema(result.schema)) {
        // Decompose each flow screen into its own tab, inheriting flow-level
        // platform and timestamp. Screens appear in sequence — tab order IS
        // the flow order.
        for (const screen of result.schema.screens) {
          const screenSchema: ScreenSchema = {
            schema: 'v1',
            type: 'screen',
            label: screen.label,
            timestamp: result.schema.timestamp,
            platform: screen.platform ?? result.schema.platform,
            sections: screen.sections,
          };
          addTab(screenSchema);
        }
      } else {
        addTab(result.schema);
      }

      getCurrentWebviewWindow()
        .show()
        .catch(() => {});
    },
    [addTab, clearTabs]
  );

  useDaemonSocket(handleMessage);

  return (
    <div className="panel">
      {tabs.length > 0 ? (
        <>
          <div className="tab-bar" data-tauri-drag-region>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={[
                  'tab',
                  tab.id === activeTabId ? 'tab--active' : '',
                  tab.status === 'loading' ? 'tab--loading' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setActiveTabId(tab.id)}
                title={tab.label}
              >
                {tab.status === 'loading' && <span className="tab-spinner" aria-hidden />}
                {tab.label}
              </button>
            ))}
          </div>
          <div className="content">
            {activeTab ? <TabContent tab={activeTab} /> : null}
          </div>
        </>
      ) : (
        <div className="idle" data-tauri-drag-region>
          <span className="idle-phrase">{idlePhrase}</span>
        </div>
      )}
    </div>
  );
}

function TabContent({ tab }: { tab: Tab }) {
  const wireframeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  if (tab.status === 'loading') {
    return <SkeletonScreen platform={tab.platform} />;
  }

  const ts = formatTimestamp(tab.timestamp);

  async function handleExportPng() {
    if (!wireframeRef.current || !tab.schema) return;
    const el = wireframeRef.current.querySelector<HTMLElement>('.wireframe');
    if (!el) return;
    await exportToPng({ label: tab.label, timestamp: tab.timestamp, element: el });
  }

  async function handleCopyContext() {
    if (!tab.schema) return;
    await copyAsContext(tab.schema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="tab-content">
      <div className="tab-content__header">
        <div className="tab-content__meta">
          <span className="tab-content__label">{tab.label}</span>
          <span className="tab-content__timestamp">{ts}</span>
        </div>
        <div className="tab-content__actions">
          <button className="export-btn" onClick={handleCopyContext} title="Copy schema as context">
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button className="export-btn" onClick={handleExportPng} title="Save as PNG">
            PNG
          </button>
        </div>
      </div>
      <div className="tab-content__wireframe" ref={wireframeRef}>
        {tab.schema && isScreenSchema(tab.schema)
          ? <WireframeScreen schema={tab.schema} />
          : null
        }
      </div>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return (
    date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' +
    date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  );
}
