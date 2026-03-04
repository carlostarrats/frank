import { useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useDaemonSocket } from './hooks/useDaemonSocket';
import { useTabs } from './hooks/useTabs';
import { validateSchema } from './schema/validate';
import { isScreenSchema } from './schema/types';
import { SkeletonScreen } from './components/SkeletonScreen';
import { WireframeScreen } from './components/wireframe/WireframeScreen';
import type { PanelMessage } from './types/messages';
import type { Tab } from './hooks/useTabs';
import './App.css';

const IDLE_PHRASES = ['Watching.', 'Ready.', 'On deck.', 'Listening.', 'Standing by.'];
const idlePhrase = IDLE_PHRASES[Math.floor(Math.random() * IDLE_PHRASES.length)];

export default function App() {
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

      addTab(result.schema);

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
  if (tab.status === 'loading') {
    return <SkeletonScreen platform={tab.platform} />;
  }

  const ts = formatTimestamp(tab.timestamp);

  return (
    <div className="tab-content">
      <div className="tab-content__header">
        <span className="tab-content__label">{tab.label}</span>
        <span className="tab-content__timestamp">{ts}</span>
      </div>
      <div className="tab-content__wireframe">
        {tab.schema && isScreenSchema(tab.schema)
          ? <WireframeScreen schema={tab.schema} />
          : <div className="flow-placeholder">Flow rendering coming in step 8.</div>
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
