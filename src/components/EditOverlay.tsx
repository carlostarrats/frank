import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Section } from '../schema/types';

interface Props {
  section: Section;
  sectionIndex: number;
  tabLabel: string;
  anchorRect: DOMRect;
  onClose: () => void;
  onSend: (prompt: string, displayText: string) => void;
}

export function EditOverlay({ section, tabLabel, anchorRect, onClose, onSend }: Props) {
  const [text, setText] = useState('');
  const [flash, setFlash] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sectionLabel = section.label ?? section.type;
  const contextSummary = section.contains.slice(0, 3).join(', ');

  function handleSubmit() {
    if (!text.trim()) return;
    const prompt = `In the "${sectionLabel}" section of "${tabLabel}": ${text.trim()}. Preserve all other screens.`;
    onSend(prompt, text.trim());
    setFlash(true);
    setTimeout(() => {
      setFlash(false);
      onClose();
    }, 1400);
  }

  const OVERLAY_W = 260;
  const OVERLAY_H = 190;
  const top = Math.min(anchorRect.bottom + 6, window.innerHeight - OVERLAY_H - 8);
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - OVERLAY_W - 8));

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top,
          left,
          zIndex: 9999,
          width: OVERLAY_W,
          background: 'var(--background, #fff)',
          border: '1px solid var(--border, #e4e4e7)',
          borderRadius: 10,
          boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Section context badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            background: 'var(--muted, #f4f4f5)',
            color: 'var(--muted-foreground, #71717a)',
            padding: '2px 7px',
            borderRadius: 99,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            userSelect: 'none',
          }}>
            {sectionLabel}
          </span>
          {contextSummary && (
            <span style={{
              fontSize: 10,
              color: 'var(--muted-foreground, #71717a)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 160,
              userSelect: 'none',
            }}>
              {contextSummary}
            </span>
          )}
        </div>

        {/* Prompt textarea — focus ring on active */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(); }}
          placeholder="Describe the change…"
          rows={3}
          style={{
            width: '100%',
            resize: 'none',
            fontSize: 12,
            lineHeight: 1.5,
            padding: '8px',
            borderRadius: 6,
            border: `1px solid ${focused ? 'var(--foreground, #18181b)' : 'var(--border, #e4e4e7)'}`,
            boxShadow: focused ? '0 0 0 2px rgba(24,24,27,0.12)' : 'none',
            background: 'var(--background, #fff)',
            color: 'var(--foreground, #09090b)',
            outline: 'none',
            fontFamily: 'inherit',
            boxSizing: 'border-box',
            transition: 'border-color 0.1s, box-shadow 0.1s',
          }}
        />

        {/* Send button / confirmation */}
        {flash ? (
          <div style={{
            fontSize: 11,
            color: 'var(--primary, #18181b)',
            textAlign: 'center',
            padding: '4px 0',
            fontWeight: 500,
            userSelect: 'none',
          }}>
            Applying edit…
          </div>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: text.trim() ? 'var(--primary, #18181b)' : 'var(--muted, #f4f4f5)',
              color: text.trim() ? 'var(--primary-foreground, #fafafa)' : 'var(--muted-foreground, #71717a)',
              cursor: text.trim() ? 'pointer' : 'default',
              width: '100%',
              transition: 'background 0.1s',
            }}
          >
            Send
          </button>
        )}
      </div>
    </>,
    document.body,
  );
}
