import { useCallback, useEffect, useRef, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { useDaemonSocket } from './hooks/useDaemonSocket';
import { useTabs } from './hooks/useTabs';
import { validateSchema } from './schema/validate';
import { isScreenSchema, isFlowSchema } from './schema/types';
import type { ScreenSchema, Section } from './schema/types';
import { SkeletonScreen } from './components/SkeletonScreen';
import { WireframeScreen } from './components/wireframe/WireframeScreen';
import { EditOverlay } from './components/EditOverlay';
import { capturePng, slugify } from './exports/png';
import { copyAsGithubMarkdown, buildMarkdown } from './exports/github';
import type { PanelMessage } from './types/messages';
import type { Tab } from './hooks/useTabs';
import './App.css';

class WireframeErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '16px', color: '#c00', fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all', background: '#fff0f0' }}>
          <strong>Render error:</strong> {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

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
  const { tabs, activeTab, activeTabId, setActiveTabId, addTab, closeTab, clearTabs } = useTabs();

  const handleMessage = useCallback(
    (msg: PanelMessage) => {
      if (msg.type === 'clear') {
        clearTabs();
        return;
      }

      const result = validateSchema(msg.schema);
      if (!result.valid) {
        console.warn('[frank] invalid schema received:', result.error);
        return;
      }

      if (isFlowSchema(result.schema)) {
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

      getCurrentWebviewWindow().show().catch(() => {});
    },
    [addTab, clearTabs]
  );

  const sendToDaemon = useDaemonSocket(handleMessage);

  // handleNavigate: switch active tab by screen label — zero render cost
  const handleNavigate = useCallback((screenLabel: string) => {
    const target = tabs.find(t => t.label === screenLabel);
    if (target) setActiveTabId(target.id);
  }, [tabs, setActiveTabId]);

  return (
    <div className="panel">
      {tabs.length > 0 ? (
        <>
          <div className="tab-bar-wrap" data-tauri-drag-region>
            <div className="tab-bar">
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
                  <span key={tab.flashKey} className={`tab-label${tab.flashKey > 0 ? ' tab-label--flash' : ''}`}>
                    {tab.label}
                  </span>
                  <span
                    className="tab-close"
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    aria-label="Close tab"
                  >×</span>
                </button>
              ))}
            </div>
          </div>
          <div className="content">
            <AnimatePresence mode="wait">
              {activeTab ? (
                <motion.div
                  key={activeTabId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.08, ease: 'easeOut' }}
                  style={{ height: '100%' }}
                >
                  <TabContent tab={activeTab} onNavigate={handleNavigate} sendToDaemon={sendToDaemon} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </>
      ) : (
        <div className="idle" data-tauri-drag-region>
          <span className="idle-wordmark">frank</span>
          <span className="idle-phrase">{idlePhrase}</span>
        </div>
      )}
    </div>
  );
}

interface TabContentProps {
  tab: Tab;
  onNavigate: (screenLabel: string) => void;
  sendToDaemon: (msg: object) => void;
}

function TabContent({ tab, onNavigate, sendToDaemon }: TabContentProps) {
  const wireframeRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editSection, setEditSection] = useState<{ section: Section; index: number; rect: DOMRect } | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [applyingText, setApplyingText] = useState('');

  // Clear applying state when a new render arrives for this tab
  useEffect(() => {
    setIsApplying(false);
    setApplyingText('');
  }, [tab.timestamp]);

  if (tab.status === 'loading') {
    return <SkeletonScreen platform={tab.platform} />;
  }

  const ts = formatTimestamp(tab.timestamp);

  function flash(label: string) {
    setConfirmed(label);
    setTimeout(() => setConfirmed(null), 2000);
  }

  function openMenu() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  function closeMenu() {
    setMenuPos(null);
  }

  async function handleCopyMarkdown() {
    closeMenu();
    if (!tab.schema) return;
    await copyAsGithubMarkdown(tab.schema);
    flash('Copied');
  }

  async function handleSaveMd() {
    closeMenu();
    if (!tab.schema) return;
    const path = await save({
      defaultPath: `${slugify(tab.label)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (path) await writeTextFile(path, buildMarkdown(tab.schema));
  }

  async function handleSavePng() {
    closeMenu();
    if (!wireframeRef.current || !tab.schema) return;
    const el = wireframeRef.current.querySelector<HTMLElement>('.wireframe');
    if (!el) return;
    try {
      const bytes = await capturePng({ label: tab.label, timestamp: tab.timestamp, element: el as HTMLElement });
      const path = await save({
        defaultPath: `frank-${slugify(tab.label)}.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      });
      if (path) {
        await writeFile(path, bytes);
        flash('Saved PNG');
      }
    } catch (e) {
      console.error('[frank] PNG export error:', e);
      flash('PNG failed');
    }
  }

  function handleSectionClick(index: number) {
    if (!tab.schema || !isScreenSchema(tab.schema)) return;
    const section = tab.schema.sections[index];
    if (!section) return;
    // Find the section element to anchor the overlay
    const sectionEls = wireframeRef.current?.querySelectorAll('.wf-section');
    const el = sectionEls?.[index] as HTMLElement | undefined;
    const rect = el?.getBoundingClientRect() ?? new DOMRect(100, 100, 200, 60);
    setEditSection({ section, index, rect });
  }

  return (
    <div className="tab-content">
      <div className="tab-content__header">
        <span className="tab-content__timestamp">{ts}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            className={`actions-toggle${editMode ? ' actions-toggle--active' : ''}`}
            onClick={() => { setEditMode(m => !m); setEditSection(null); }}
            title={editMode ? 'Exit edit mode' : 'Edit a section'}
          >
            <Pencil size={13} />
          </button>
          <button ref={buttonRef} className="actions-toggle" onClick={openMenu} title="Export options">
            {confirmed
              ? <span className="actions-toggle__confirmed">{confirmed}</span>
              : <span className="actions-toggle__dots" aria-hidden><span/><span/><span/></span>
            }
          </button>
        </div>
      </div>

      {/* Wireframe container */}
      <div className="tab-content__wireframe" ref={wireframeRef} style={{ position: 'relative' }}>
        {isApplying && (
          <div className="applying-overlay">
            <span className="applying-spinner" />
            {applyingText && (
              <span className="applying-label">
                {applyingText.length > 48 ? applyingText.slice(0, 48) + '…' : applyingText}
              </span>
            )}
          </div>
        )}
        <WireframeErrorBoundary>
          {tab.schema && isScreenSchema(tab.schema)
            ? <WireframeScreen
                schema={tab.schema}
                onNavigate={onNavigate}
                editMode={editMode}
                onSectionClick={handleSectionClick}
              />
            : null
          }
        </WireframeErrorBoundary>
      </div>

      {/* Actions dropdown */}
      {menuPos && (
        <>
          <div className="actions-menu-overlay" onClick={closeMenu} />
          <div className="actions-menu" style={{ top: menuPos.top, right: menuPos.right }}>
            <button className="actions-menu__item" onClick={handleCopyMarkdown}>Copy Markdown</button>
            <button className="actions-menu__item" onClick={handleSaveMd}>Save .md</button>
            <div className="actions-menu__separator" />
            <button className="actions-menu__item" onClick={handleSavePng}>Save PNG</button>
          </div>
        </>
      )}

      {/* Edit overlay portal */}
      {editSection && (
        <EditOverlay
          section={editSection.section}
          sectionIndex={editSection.index}
          tabLabel={tab.label}
          anchorRect={editSection.rect}
          onClose={() => setEditSection(null)}
          onSend={(prompt, displayText) => { setIsApplying(true); setApplyingText(displayText); sendToDaemon({ type: 'inject', prompt }); }}
        />
      )}
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
