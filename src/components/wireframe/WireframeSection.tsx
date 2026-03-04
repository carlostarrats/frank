// Dispatch layer + shared atoms (WireframeChip, SectionNote, ChipContainer).
// All 14 section type components live in this file — they're small enough
// that individual files would add file-navigation overhead without benefit.

import type { Section, Layout } from '../../schema/types';
import './sections.css';

// ─── Public dispatch ──────────────────────────────────────────────────────────

interface SectionProps {
  section: Section;
}

export function WireframeSection({ section }: SectionProps) {
  return (
    <div className={`wf-section wf-section--${section.type}`}>
      {renderSection(section)}
      {section.note && <SectionNote text={section.note} />}
    </div>
  );
}

function renderSection(section: Section) {
  switch (section.type) {
    case 'header':      return <HeaderSection section={section} />;
    case 'hero':        return <HeroSection section={section} />;
    case 'content':     return <ContentSection section={section} />;
    case 'top-nav':     return <TopNavSection section={section} />;
    case 'bottom-nav':  return <BottomNavSection section={section} />;
    case 'sidebar':     return <SidebarSection section={section} />;
    case 'form':        return <FormSection section={section} />;
    case 'list':        return <ListSection section={section} />;
    case 'grid':        return <GridSection section={section} />;
    case 'footer':      return <FooterSection section={section} />;
    case 'empty-state': return <EmptyStateSection section={section} />;
    case 'banner':      return <BannerSection section={section} />;
    case 'toolbar':     return <ToolbarSection section={section} />;
    case 'modal':       return <ModalSection section={section} />;
  }
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

export function WireframeChip({ label }: { label: string }) {
  return <div className="wf-chip">{label}</div>;
}

export function ChipContainer({ items, layout }: { items: string[]; layout?: Layout }) {
  return (
    <div className={`wf-chips wf-chips--${layout ?? 'column'}`}>
      {items.map((item, i) => <WireframeChip key={i} label={item} />)}
    </div>
  );
}

function SectionNote({ text }: { text: string }) {
  return (
    <div className="wf-note">
      <span className="wf-note__marker">note</span>
      <span>{text}</span>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <div className="wf-section__label">{label}</div>;
}

// ─── Section components ───────────────────────────────────────────────────────

function HeaderSection({ section }: SectionProps) {
  return (
    <div className="wf-header-row">
      {section.contains.map((item, i) => <WireframeChip key={i} label={item} />)}
    </div>
  );
}

function HeroSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      {section.contains.map((item, i) => <WireframeChip key={i} label={item} />)}
    </>
  );
}

function ContentSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <ChipContainer items={section.contains} layout={section.layout} />
    </>
  );
}

function TopNavSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <ChipContainer items={section.contains} layout="row" />
    </>
  );
}

function BottomNavSection({ section }: SectionProps) {
  return (
    <>
      {section.contains.map((item, i) => (
        <div key={i} className="wf-bottom-nav-item">
          <div className="wf-bottom-nav-item__icon" />
          <span className="wf-bottom-nav-item__label">{item}</span>
        </div>
      ))}
    </>
  );
}

function SidebarSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <div className="wf-sidebar-items">
        {section.contains.map((item, i) => (
          <div key={i} className={`wf-sidebar-item ${i === 1 ? 'wf-sidebar-item--active' : ''}`}>
            {item}
          </div>
        ))}
      </div>
    </>
  );
}

function FormSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <div className="wf-form-body">
        {section.contains.map((item, i) => {
          const isButton = /button|submit|continue|save|cta|sign up|log in/i.test(item);
          return (
            <div key={i} className={`wf-form-field ${isButton ? 'wf-form-field--button' : ''}`}>
              {item}
            </div>
          );
        })}
      </div>
    </>
  );
}

function ListSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <div className="wf-list">
        {section.contains.map((item, i) => (
          <div key={i} className="wf-list-row">
            <span>{item}</span>
            <span className="wf-list-row__chevron">›</span>
          </div>
        ))}
      </div>
    </>
  );
}

function GridSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <ChipContainer items={section.contains} layout="grid" />
    </>
  );
}

function FooterSection({ section }: SectionProps) {
  return (
    <>
      {section.contains.map((item, i) => <WireframeChip key={i} label={item} />)}
    </>
  );
}

function EmptyStateSection({ section }: SectionProps) {
  const ILLUSTRATION_PATTERN = /illustration|image|icon|graphic|placeholder/i;
  const hasIllustration = section.contains.some((c) => ILLUSTRATION_PATTERN.test(c));
  const textItems = section.contains.filter((c) => !ILLUSTRATION_PATTERN.test(c));

  return (
    <div className="wf-empty-state">
      {hasIllustration && <div className="wf-empty-state__illustration" aria-hidden />}
      {section.label && <SectionLabel label={section.label} />}
      {textItems.map((item, i) => <WireframeChip key={i} label={item} />)}
    </div>
  );
}

function BannerSection({ section }: SectionProps) {
  return (
    <>
      {section.label && <SectionLabel label={section.label} />}
      <ChipContainer items={section.contains} layout="row" />
    </>
  );
}

function ToolbarSection({ section }: SectionProps) {
  return (
    <>
      {section.contains.map((item, i) => <WireframeChip key={i} label={item} />)}
    </>
  );
}

function ModalSection({ section }: SectionProps) {
  return (
    <div className="wf-modal-dialog">
      <div className="wf-modal-dialog__title">
        {section.label ?? 'Dialog'}
      </div>
      {section.contains.map((item, i) => <WireframeChip key={i} label={item} />)}
    </div>
  );
}
