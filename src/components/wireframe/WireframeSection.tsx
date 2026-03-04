// Higher-fidelity wireframe section renderer.
// Uses shadcn/ui components and Tailwind utilities directly — no custom CSS for layout or typography.
// sections.css is kept only for outer section structural chrome (borders, backgrounds, margin-top).

import type { Section } from '../../schema/types';
import {
  ChevronLeft, ChevronRight, X, Settings, Search, Menu, Plus, Share2, Pencil, Bell,
  MapPin, Navigation, Home, User, Heart, Bookmark, Clock, MessageSquare, ShoppingCart,
  Compass, BarChart2, Camera, BookOpen, TrendingUp, Star, Grid2x2, List,
  CreditCard, Wallet, Send, Phone, Video, Music, Image, FileText, LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import './sections.css';

interface SectionProps {
  section: Section;
  screenLabel?: string;
  platform?: string;
}

export function WireframeSection({ section, screenLabel, platform }: SectionProps) {
  return (
    <div className={`wf-section wf-section--${section.type}`}>
      {renderSection(section, screenLabel, platform)}
    </div>
  );
}

function renderSection(section: Section, screenLabel?: string, platform?: string) {
  switch (section.type) {
    case 'header':      return <HeaderSection section={section} />;
    case 'hero':        return <HeroSection section={section} platform={platform} />;
    case 'content':     return <ContentSection section={section} />;
    case 'top-nav':     return <TopNavSection section={section} />;
    case 'bottom-nav':  return <BottomNavSection section={section} screenLabel={screenLabel} />;
    case 'sidebar':     return <SidebarSection section={section} screenLabel={screenLabel} />;
    case 'form':        return <FormSection section={section} />;
    case 'list':        return <ListSection section={section} />;
    case 'grid':        return <GridSection section={section} />;
    case 'footer':      return <FooterSection section={section} />;
    case 'empty-state': return <EmptyStateSection section={section} />;
    case 'banner':      return <BannerSection section={section} />;
    case 'toolbar':     return <ToolbarSection section={section} />;
    case 'modal':       return <ModalSection section={section} />;
    case 'section-group':    return <SectionGroupSection section={section} />;
    case 'action-row':       return <ActionRowSection section={section} />;
    case 'stats-row':        return <StatsRowSection section={section} />;
    // ── Loader / splash ───────────────────────────────────────────────────
    case 'loader':           return <LoaderSection section={section} />;
    case 'splash':           return <LoaderSection section={section} />;
    // ── Map app patterns ──────────────────────────────────────────────────
    case 'map':              return <MapSection section={section} />;
    case 'category-strip':   return <CategoryStripSection section={section} />;
    case 'place-list':       return <PlaceListSection section={section} />;
    case 'floating-search':  return <FloatingSearchSection section={section} />;
    case 'map-controls':     return <MapControlsSection section={section} />;
    // ── Common patterns ───────────────────────────────────────────────────
    case 'tabs':
    case 'tab-bar':          return <TabsSection section={section} />;
    case 'card-row':
    case 'feature-grid':
    case 'feature-list':     return <FeatureSection section={section} />;
    case 'chart':
    case 'graph':            return <ChartSection section={section} />;
    case 'onboarding':
    case 'onboarding-step':  return <OnboardingSection section={section} />;
    case 'pricing':
    case 'pricing-table':    return <PricingSection section={section} />;
    case 'testimonial':
    case 'quote':            return <TestimonialSection section={section} />;
    case 'image-gallery':
    case 'gallery':          return <GallerySection section={section} />;
    default:                 return <GenericSection section={section} />;
  }
}

// ─── Shared label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2 select-none">
      {children}
    </div>
  );
}

// ─── SmartItem ────────────────────────────────────────────────────────────────
// Classifies a string from contains[] and renders the right shadcn/Tailwind element.

type ItemType =
  | 'headline' | 'subheadline' | 'body-text'
  | 'btn-primary' | 'btn-secondary' | 'btn-destructive'
  | 'toggle-on' | 'toggle-off' | 'row-chevron'
  | 'image' | 'avatar' | 'icon' | 'logo'
  | 'input' | 'badge' | 'stat-label' | 'nav-item' | 'text';

function classify(raw: string): ItemType {
  const s = raw.toLowerCase();
  if (/·\s*toggle\s+on\b/i.test(s)) return 'toggle-on';
  if (/·\s*toggle\s+off\b/i.test(s)) return 'toggle-off';
  if (/·\s*chevron\b/i.test(s)) return 'row-chevron';
  if (/—\s*destructive\b/i.test(s)) return 'btn-destructive';
  if (/·\s*label\s*$/i.test(s)) return 'stat-label';
  if (/\b(headline|h1|main title|page title|hero title)\b/.test(s)) return 'headline';
  if (/\b(subheadline|subtitle|h2|h3|tagline|description|subtext|supporting)\b/.test(s)) return 'subheadline';
  if (/\b(body|paragraph|copy|body text|text block)\b/.test(s)) return 'body-text';
  if (/\b(primary button|cta|call to action|get started|try free|sign up now|download now)\b/.test(s)) return 'btn-primary';
  if (/\b(button|btn|submit|continue|next|save|confirm|create|sign up|log in|register|send)\b/.test(s)) return 'btn-primary';
  if (/\b(secondary|cancel|back|dismiss|skip|maybe later|no thanks|outline|ghost)\b/.test(s) && /\b(button|btn|action)\b/.test(s)) return 'btn-secondary';
  if (/\b(image|photo|thumbnail|cover|hero image|banner image|illustration|picture|poster)\b/.test(s)) return 'image';
  if (/\b(avatar|profile photo|user photo|profile pic|profile image|user avatar)\b/.test(s)) return 'avatar';
  if (/\b(logo|brand|wordmark)\b/.test(s)) return 'logo';
  if (/\b(icon|symbol)\b/.test(s) && !/\blogo\b/.test(s)) return 'icon';
  if (/\b(input|field|email|password|search|form field|phone|name|first name|last name|address|message|textarea|username)\b/.test(s)) return 'input';
  if (/\b(badge|tag|chip|status|label|pill|count)\b/.test(s)) return 'badge';
  if (/\b(link|nav link|menu item)\b/.test(s)) return 'nav-item';
  return 'text';
}

function displayLabel(raw: string): string {
  return raw
    .replace(/\s*—\s*.+$/i, '')
    .replace(/\s*·\s*(toggle\s+on|toggle\s+off|chevron|label)\s*$/i, '')
    .replace(/\s*(primary\s+)?(secondary\s+)?(ghost\s+)?(outline\s+)?button\b/i, '')
    .replace(/\s+\b(headline|subheadline|subtitle|input|icon|image|avatar|logo|badge|link|label)\b/i, '')
    .trim() || raw;
}

function SmartItem({ label }: { label: string }) {
  const type = classify(label);
  const text = displayLabel(label);

  switch (type) {
    case 'headline':
      return <p className="text-2xl font-bold text-foreground leading-tight select-none">{text}</p>;

    case 'subheadline':
      return <p className="text-sm text-muted-foreground leading-snug select-none">{text}</p>;

    case 'body-text':
      return (
        <div className="flex flex-col gap-1.5 w-full">
          <div className="h-2 bg-border rounded-sm w-full" />
          <div className="h-2 bg-border rounded-sm" style={{ width: '91%' }} />
          <div className="h-2 bg-border rounded-sm" style={{ width: '76%' }} />
        </div>
      );

    case 'btn-primary':
      return <Button>{text}</Button>;

    case 'btn-secondary':
      return <Button variant="outline">{text}</Button>;

    case 'btn-destructive':
      return <Button variant="outline">{text}</Button>;

    case 'toggle-on':
      return (
        <div className="flex items-center justify-between w-full">
          <span className="text-sm text-foreground select-none">{text}</span>
          <Switch checked={true} />
        </div>
      );

    case 'toggle-off':
      return (
        <div className="flex items-center justify-between w-full">
          <span className="text-sm text-foreground select-none">{text}</span>
          <Switch checked={false} />
        </div>
      );

    case 'row-chevron':
      return (
        <div className="flex items-center justify-between w-full">
          <span className="text-sm text-foreground select-none">{text}</span>
          <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
        </div>
      );

    case 'image':
      return <div className="wf-image-placeholder w-full aspect-video rounded-md" aria-label={label} />;

    case 'avatar':
      return (
        <Avatar>
          <AvatarFallback>{text.slice(0, 2).toUpperCase() || 'U'}</AvatarFallback>
        </Avatar>
      );

    case 'logo':
      return (
        <span className="text-xs font-bold tracking-widest text-foreground bg-muted border border-border rounded px-2 py-0.5 select-none">
          LOGO
        </span>
      );

    case 'icon':
      return <span className="text-muted-foreground flex-shrink-0"><HeaderIcon desc={label} /></span>;

    case 'input':
      return (
        <div className="flex flex-col gap-1 w-full">
          <Label>{text}</Label>
          <Input placeholder={text} />
        </div>
      );

    case 'stat-label':
      return <div className="text-sm text-foreground select-none">{text}</div>;

    case 'badge':
      return <Badge variant="secondary">{text}</Badge>;

    case 'nav-item':
      return <span className="text-sm text-muted-foreground underline underline-offset-2 select-none">{text}</span>;

    default:
      return <div className="text-sm text-muted-foreground select-none">{text}</div>;
  }
}

// ─── Section components ───────────────────────────────────────────────────────

function HeaderIcon({ desc }: { desc: string }) {
  const d = desc.toLowerCase();
  const p = { size: 18, strokeWidth: 1.75 } as const;
  if (/\bback\b/.test(d))                    return <ChevronLeft {...p} />;
  if (/\bforward\b/.test(d))                 return <ChevronRight {...p} />;
  if (/\b(close|dismiss)\b/.test(d))         return <X {...p} />;
  if (/\bsettings\b/.test(d))                return <Settings {...p} />;
  if (/\bsearch\b/.test(d))                  return <Search {...p} />;
  if (/\b(menu|hamburger)\b/.test(d))        return <Menu {...p} />;
  if (/\badd\b|\bplus\b|\bcreate\b/.test(d)) return <Plus {...p} />;
  if (/\bshare\b/.test(d))                   return <Share2 {...p} />;
  if (/\bedit\b|\bpencil\b/.test(d))         return <Pencil {...p} />;
  if (/\bnotif|\bbell\b/.test(d))            return <Bell {...p} />;
  return <Settings {...p} />;
}

function HeaderSection({ section }: SectionProps) {
  const items = section.contains;
  const hasLogo   = items.some(s => /\b(logo|brand|wordmark)\b/i.test(s));
  const hasAvatar = items.some(s => /\b(avatar|profile photo|user photo|user avatar)\b/i.test(s));

  if (hasLogo || hasAvatar) {
    const logoItems   = items.filter(s => /\b(logo|brand)\b/i.test(s));
    const avatarItems = items.filter(s => /\b(avatar|profile photo|user photo|user avatar)\b/i.test(s));
    const navItems    = items.filter(s => !logoItems.includes(s) && !avatarItems.includes(s));
    return (
      <div className="flex items-center w-full gap-3">
        {logoItems.length > 0 && (
          <span className="text-xs font-bold tracking-widest text-foreground bg-muted border border-border rounded px-2 py-0.5 flex-shrink-0 select-none">
            LOGO
          </span>
        )}
        <nav className="flex items-center gap-4 flex-1 overflow-x-auto">
          {navItems.map((item, i) => (
            <span key={i} className="text-sm text-muted-foreground whitespace-nowrap select-none">
              {displayLabel(item)}
            </span>
          ))}
        </nav>
        {avatarItems.length > 0 && (
          <div className="ml-auto flex-shrink-0">
            <div className="w-6 h-6 rounded-full bg-muted border border-border" />
          </div>
        )}
      </div>
    );
  }

  const leftItems   = items.filter(s => /\b(back|close|dismiss|cancel|menu|hamburger)\b/i.test(s));
  const centerItems = items.filter(s =>
    /\b(label|title|heading)\b/i.test(s) && !leftItems.includes(s)
  );
  const rightItems  = items.filter(s => !leftItems.includes(s) && !centerItems.includes(s));

  return (
    <div className="flex items-center w-full">
      <div className="w-11 flex items-center gap-1">
        {leftItems.map((item, i) => (
          <span key={i} className="text-foreground"><HeaderIcon desc={item} /></span>
        ))}
      </div>
      <div className="flex-1 flex justify-center items-center">
        {centerItems.map((item, i) => (
          <span key={i} className="text-sm font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis select-none">
            {displayLabel(item)}
          </span>
        ))}
      </div>
      <div className="w-11 flex items-center justify-end gap-1">
        {rightItems.map((item, i) => (
          <span key={i} className="text-foreground"><HeaderIcon desc={item} /></span>
        ))}
      </div>
    </div>
  );
}

function HeroSection({ section, platform }: SectionProps) {
  const isWeb = platform === 'web' || platform === 'tablet';
  if (isWeb) {
    return (
      <div className="flex flex-row items-center gap-12 py-12 px-10 min-h-[320px]">
        <div className="flex-1 flex flex-col items-start gap-4">
          {section.label && <SectionLabel>{section.label}</SectionLabel>}
          {section.contains.map((item, i) => {
            if (classify(item) === 'headline') {
              return <p key={i} className="text-4xl font-bold text-foreground leading-tight select-none">{displayLabel(item)}</p>;
            }
            return <SmartItem key={i} label={item} />;
          })}
        </div>
        <div className="wf-image-placeholder flex-1 min-h-[220px] rounded-xl" />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3.5 text-center py-9 px-6">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      {section.contains.map((item, i) => {
        if (classify(item) === 'headline') {
          return <p key={i} className="text-2xl font-bold text-foreground leading-tight max-w-[260px] select-none">{displayLabel(item)}</p>;
        }
        return <SmartItem key={i} label={item} />;
      })}
    </div>
  );
}

function ContentSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      {section.contains.map((item, i) => <SmartItem key={i} label={item} />)}
    </div>
  );
}

function TopNavSection({ section }: SectionProps) {
  const isLogo = (s: string) => /\blogo\b/i.test(s);
  const isCta  = (s: string) => /\bbutton\b/i.test(s);
  const isAuth = (s: string) => /\b(log\s*in|sign\s*in|login)\b/i.test(s);

  const logoItem = section.contains.find(isLogo);
  const ctaItem  = section.contains.find(isCta);
  const authItem = section.contains.find(isAuth);
  const navItems = section.contains.filter(s => !isLogo(s) && !isCta(s) && !isAuth(s));

  return (
    <div className="flex items-center h-[52px] border-b border-border px-5">
      {logoItem && (
        <span className="text-sm font-bold text-foreground mr-6 flex-shrink-0 select-none">
          {displayLabel(logoItem)}
        </span>
      )}
      <nav className="flex items-center gap-1 flex-1">
        {navItems.map((item, i) => (
          <span key={i} className="px-2.5 py-1.5 text-sm text-muted-foreground rounded select-none">
            {item}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-2 flex-shrink-0">
        {authItem && (
          <span className="text-sm text-muted-foreground px-2.5 py-1.5 select-none">{authItem}</span>
        )}
        {ctaItem && <Button size="sm">{displayLabel(ctaItem)}</Button>}
      </div>
    </div>
  );
}

function navIcon(label: string) {
  const l = label.toLowerCase();
  const p = { size: 22, strokeWidth: 1.75 } as const;
  if (/\bhome\b/.test(l))                                  return <Home {...p} />;
  if (/\bsearch\b/.test(l))                                return <Search {...p} />;
  if (/\bdirections?\b/.test(l))                           return <Navigation {...p} />;
  if (/\brecents?\b|\bhistory\b/.test(l))                  return <Clock {...p} />;
  if (/\bsaved?\b|\bbookmark\b/.test(l))                   return <Bookmark {...p} />;
  if (/\bprofile\b|\baccount\b|\bme\b|\buser\b/.test(l))  return <User {...p} />;
  if (/\bsettings?\b/.test(l))                             return <Settings {...p} />;
  if (/\bnotif|\bbell\b/.test(l))                          return <Bell {...p} />;
  if (/\bmessage|\bchat\b|\binbox\b/.test(l))              return <MessageSquare {...p} />;
  if (/\bcart\b|\bshop\b|\bstore\b/.test(l))               return <ShoppingCart {...p} />;
  if (/\bheart\b|\blike\b|\bfavorite\b/.test(l))           return <Heart {...p} />;
  if (/\bexplore\b|\bdisc?over\b|\bcompass\b/.test(l))     return <Compass {...p} />;
  if (/\bmap\b/.test(l))                                   return <MapPin {...p} />;
  if (/\banalytics?\b|\bstats?\b/.test(l))                 return <BarChart2 {...p} />;
  if (/\bcamera\b|\bphoto\b/.test(l))                      return <Camera {...p} />;
  if (/\btrend\b/.test(l))                                 return <TrendingUp {...p} />;
  if (/\bfeed\b|\blist\b/.test(l))                         return <List {...p} />;
  if (/\bdashboard\b/.test(l))                             return <LayoutDashboard {...p} />;
  if (/\bgrid\b/.test(l))                                  return <Grid2x2 {...p} />;
  if (/\bcard\b|\bpayment\b/.test(l))                      return <CreditCard {...p} />;
  if (/\bwallet\b|\bmoney\b|\bfinance\b/.test(l))          return <Wallet {...p} />;
  if (/\bsend\b|\btransfer\b/.test(l))                     return <Send {...p} />;
  if (/\bphone\b|\bcall\b/.test(l))                        return <Phone {...p} />;
  if (/\bvideo\b/.test(l))                                 return <Video {...p} />;
  if (/\bmusic\b|\baudio\b/.test(l))                       return <Music {...p} />;
  if (/\bimage\b|\bgallery\b/.test(l))                     return <Image {...p} />;
  if (/\bdoc\b|\bfile\b|\bnote\b/.test(l))                 return <FileText {...p} />;
  if (/\bstar\b|\brating\b/.test(l))                       return <Star {...p} />;
  if (/\bplus\b|\badd\b|\bcreate\b|\bnew\b/.test(l))       return <Plus {...p} />;
  if (/\bshare\b/.test(l))                                 return <Share2 {...p} />;
  if (/\bbook\b|\blibrary\b/.test(l))                      return <BookOpen {...p} />;
  // default: a small grid icon
  return <Grid2x2 {...p} />;
}

function BottomNavSection({ section, screenLabel }: SectionProps) {
  return (
    <>
      {section.contains.map((item, i) => {
        const active = screenLabel
          ? item.toLowerCase() === screenLabel.toLowerCase() ||
            screenLabel.toLowerCase().includes(item.toLowerCase())
          : i === 0;
        return (
          <div key={i} className={`flex flex-col items-center gap-1 ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
            {navIcon(item)}
            <span className="text-[0.6875rem] font-medium select-none">{item}</span>
          </div>
        );
      })}
    </>
  );
}

function SidebarSection({ section, screenLabel }: SectionProps) {
  return (
    <div className="flex flex-col gap-0.5">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      {section.contains.map((item, i) => {
        const active = screenLabel
          ? item.toLowerCase() === screenLabel.toLowerCase() ||
            screenLabel.toLowerCase().includes(item.toLowerCase())
          : i === 0;
        return (
          <div key={i} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm font-medium select-none ${
            active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
          }`}>
            <span className="flex-shrink-0">{navIcon(item)}</span>
            <span>{item}</span>
          </div>
        );
      })}
    </div>
  );
}

function FormSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      {section.contains.map((item, i) => <SmartItem key={i} label={item} />)}
    </div>
  );
}

function ListSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col">
      {section.label && (
        <div className="px-4 pt-2.5 pb-1">
          <SectionLabel>{section.label}</SectionLabel>
        </div>
      )}
      {section.contains.map((item, i) => (
        <div key={i}>
          <div className="flex items-center gap-3 px-4 py-2.5">
            <Avatar className="w-8 h-8 flex-shrink-0">
              <AvatarFallback className="text-xs">{item.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 flex flex-col gap-1 min-w-0">
              <div className="text-sm font-medium text-foreground select-none">{item}</div>
              <div className="h-1.5 w-3/5 bg-border rounded-sm" />
            </div>
            <ChevronRight size={16} className="text-border flex-shrink-0" />
          </div>
          {i < section.contains.length - 1 && <Separator />}
        </div>
      ))}
    </div>
  );
}

function GridSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      <div className="grid grid-cols-2 gap-2.5">
        {section.contains.map((item, i) => (
          <Card key={i} className="overflow-hidden p-0 gap-0">
            <div className="wf-image-placeholder w-full h-[120px]" />
            <CardContent className="p-3">
              <p className="text-sm font-medium text-foreground select-none">{displayLabel(item)}</p>
              {item.includes('—') && (
                <p className="text-xs text-muted-foreground mt-0.5 select-none">{item.split('—')[1]?.trim()}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FooterSection({ section }: SectionProps) {
  const isLogo      = (s: string) => /\blogo\b/i.test(s);
  const isCopyright = (s: string) => /^©/.test(s.trim());
  const logo        = section.contains.find(isLogo);
  const copyright   = section.contains.find(isCopyright);
  const links       = section.contains.filter(s => !isLogo(s) && !isCopyright(s));
  return (
    <div className="flex flex-col gap-2.5 px-5 py-4">
      <div className="flex items-center gap-4 flex-wrap">
        {logo && (
          <span className="text-xs font-bold tracking-widest text-foreground bg-muted border border-border rounded px-2 py-0.5 flex-shrink-0 select-none">
            LOGO
          </span>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {links.map((item, i) => (
            <span key={i} className="text-xs text-muted-foreground select-none">{item}</span>
          ))}
        </div>
      </div>
      {copyright && (
        <div className="text-xs text-muted-foreground/60 select-none">{copyright}</div>
      )}
    </div>
  );
}

function EmptyStateSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="w-16 h-16 rounded-2xl bg-muted border border-border mb-1" aria-hidden />
      {section.contains.map((item, i) => <SmartItem key={i} label={item} />)}
    </div>
  );
}

function BannerSection({ section }: SectionProps) {
  const items   = section.contains.filter(c => !classify(c).startsWith('btn'));
  const actions = section.contains.filter(c =>  classify(c).startsWith('btn'));
  return (
    <div className="flex flex-col items-start gap-2">
      {items.map((item, i) => <SmartItem key={i} label={item} />)}
      {actions.map((item, i) => <SmartItem key={i} label={item} />)}
    </div>
  );
}

function ToolbarSection({ section }: SectionProps) {
  return (
    <>
      {section.contains.map((item, i) => (
        <Button key={i} variant="outline" size="icon" title={item}>
          <HeaderIcon desc={item} />
        </Button>
      ))}
    </>
  );
}

function SectionGroupSection({ section }: SectionProps) {
  return (
    <div>
      {section.label && (
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-3.5 pb-1.5 px-1 select-none">
          {section.label}
        </div>
      )}
      <div className="bg-background border border-border rounded-xl overflow-hidden">
        {section.contains.map((item, i) => (
          <div key={i}>
            <div className="flex items-center px-3.5 py-[11px]">
              <SmartItem label={item} />
            </div>
            {i < section.contains.length - 1 && (
              <div className="h-px bg-border ml-3.5" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionRowSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col items-start gap-2.5">
      {section.contains.map((item, i) => (
        <SmartItem key={i} label={item} />
      ))}
    </div>
  );
}

function StatsRowSection({ section }: SectionProps) {
  return (
    <div className="flex flex-row border-y border-border">
      {section.contains.map((item, i) => {
        const parts = item.split(/\s+/);
        const value = parts[0] ?? '';
        const label = parts.slice(1).join(' ');
        return (
          <div key={i} className={`flex-1 flex flex-col items-center py-5 px-4 gap-1 ${
            i < section.contains.length - 1 ? 'border-r border-border' : ''
          }`}>
            <div className="text-2xl font-bold text-foreground select-none">{value}</div>
            <div className="text-xs text-muted-foreground text-center select-none">{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// GenericSection: auto-detects the best layout from content — never looks broken.
function GenericSection({ section }: SectionProps) {
  const items = section.contains;
  const layout = (section as any).layout as string | undefined;

  // Chips: explicit row layout, or all short single-concept items with no type keywords
  const allShort = items.every(s => s.length < 20 && !/\b(button|input|image|avatar|headline|subheadline|body|toggle|chevron)\b/i.test(s));
  const isChips  = layout === 'row' || (allShort && items.length >= 3);

  // Detail rows: items contain '—' (name — detail pattern)
  const isDetailList = !isChips && items.some(s => s.includes('—'));

  // Nav links: items look like navigation labels
  const isNav = !isChips && !isDetailList && items.every(s => s.length < 24 && /^[A-Z]/.test(s));

  return (
    <div className="flex flex-col gap-2 w-full">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}

      {isChips && (
        <div className="flex flex-wrap items-center gap-2">
          {items.map((item, i) => (
            <Badge key={i} variant="secondary" className="rounded-full px-3 select-none">
              {displayLabel(item)}
            </Badge>
          ))}
        </div>
      )}

      {isDetailList && (
        <div className="flex flex-col">
          {items.map((item, i) => {
            const [name, detail] = item.split('—').map(s => s.trim());
            return (
              <div key={i}>
                <div className="flex items-center gap-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground select-none">{name}</div>
                    {detail && <div className="text-xs text-muted-foreground select-none">{detail}</div>}
                  </div>
                  <ChevronRight size={16} className="text-border flex-shrink-0" />
                </div>
                {i < items.length - 1 && <Separator />}
              </div>
            );
          })}
        </div>
      )}

      {isNav && !isChips && !isDetailList && (
        <div className="flex flex-wrap items-center gap-1">
          {items.map((item, i) => (
            <span key={i} className="px-3 py-1.5 text-sm text-muted-foreground rounded select-none">{item}</span>
          ))}
        </div>
      )}

      {!isChips && !isDetailList && !isNav && (
        <div className="flex flex-col items-start gap-2">
          {items.map((item, i) => <SmartItem key={i} label={item} />)}
        </div>
      )}
    </div>
  );
}

// ─── Common pattern renderers ─────────────────────────────────────────────────

function TabsSection({ section }: SectionProps) {
  return (
    <div className="flex border-b border-border">
      {section.contains.map((item, i) => (
        <div key={i} className={`px-4 py-2.5 text-sm font-medium select-none whitespace-nowrap cursor-default ${
          i === 0
            ? 'text-foreground border-b-2 border-foreground -mb-px'
            : 'text-muted-foreground'
        }`}>
          {item}
        </div>
      ))}
    </div>
  );
}

function FeatureSection({ section }: SectionProps) {
  const isGrid = (section as any).layout === 'grid' || section.type === 'feature-grid';
  return (
    <div className="flex flex-col gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      <div className={isGrid ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-2'}>
        {section.contains.map((item, i) => {
          const [title, desc] = item.split('—').map(s => s.trim());
          return (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-background">
              <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-muted-foreground"><HeaderIcon desc={title} /></span>
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-sm font-medium text-foreground select-none">{title}</span>
                {desc && <span className="text-xs text-muted-foreground select-none">{desc}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChartSection({ section: _ }: SectionProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="w-full h-[160px] bg-muted border border-border rounded-lg relative overflow-hidden">
        {/* Y-axis lines */}
        {[0.25, 0.5, 0.75].map(p => (
          <div key={p} className="absolute w-full border-t border-border/60" style={{ top: `${p * 100}%` }} />
        ))}
        {/* Bars */}
        <div className="absolute inset-x-4 bottom-0 flex items-end justify-between gap-2 h-full pb-0">
          {[65, 45, 80, 55, 70, 40, 75].map((h, i) => (
            <div key={i} className="flex-1 bg-foreground/15 border border-border rounded-t-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function OnboardingSection({ section }: SectionProps) {
  const stepItems  = section.contains.filter(s => !classify(s).startsWith('btn'));
  const btnItems   = section.contains.filter(s =>  classify(s).startsWith('btn'));
  return (
    <div className="flex flex-col items-center gap-6 text-center py-8 px-6">
      <div className="wf-image-placeholder w-24 h-24 rounded-2xl" />
      <div className="flex flex-col gap-2 max-w-[260px]">
        {stepItems.map((item, i) => {
          if (classify(item) === 'headline') return <p key={i} className="text-xl font-bold text-foreground select-none">{displayLabel(item)}</p>;
          return <SmartItem key={i} label={item} />;
        })}
      </div>
      {btnItems.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          {btnItems.map((item, i) => <SmartItem key={i} label={item} />)}
        </div>
      )}
      {/* Step dots */}
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1.5 rounded-full ${i === 0 ? 'w-4 bg-foreground' : 'w-1.5 bg-border'}`} />
        ))}
      </div>
    </div>
  );
}

function PricingSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      <div className="grid grid-cols-2 gap-3">
        {section.contains.map((item, i) => {
          const [name, price] = item.split('—').map(s => s.trim());
          const featured = i === 1;
          return (
            <div key={i} className={`flex flex-col gap-3 p-4 rounded-xl border ${featured ? 'border-foreground bg-foreground text-background' : 'border-border bg-background'}`}>
              <span className={`text-xs font-semibold uppercase tracking-wider select-none ${featured ? 'text-background/70' : 'text-muted-foreground'}`}>{name}</span>
              {price && <span className={`text-2xl font-bold select-none ${featured ? 'text-background' : 'text-foreground'}`}>{price}</span>}
              {[0, 1, 2].map(j => (
                <div key={j} className={`h-1.5 rounded-sm ${featured ? 'bg-background/20' : 'bg-border'}`} style={{ width: `${70 - j * 15}%` }} />
              ))}
              <Button size="sm" variant={featured ? 'secondary' : 'outline'} className="mt-1">Get started</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TestimonialSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col gap-4">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      {section.contains.map((item, i) => {
        const [quote, author] = item.split('—').map(s => s.trim());
        return (
          <div key={i} className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-background">
            <div className="flex flex-col gap-1.5">
              <div className="h-2 bg-border rounded-sm w-full" />
              <div className="h-2 bg-border rounded-sm" style={{ width: '85%' }} />
              <div className="h-2 bg-border rounded-sm" style={{ width: '70%' }} />
            </div>
            {quote && <p className="text-sm text-muted-foreground italic select-none">"{quote}"</p>}
            {author && (
              <div className="flex items-center gap-2">
                <Avatar className="w-6 h-6"><AvatarFallback className="text-[10px]">{author.slice(0,2).toUpperCase()}</AvatarFallback></Avatar>
                <span className="text-xs font-medium text-foreground select-none">{author}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GallerySection({ section }: SectionProps) {
  return (
    <div className="flex flex-col gap-3">
      {section.label && <SectionLabel>{section.label}</SectionLabel>}
      <div className="grid grid-cols-3 gap-1.5">
        {section.contains.map((item, i) => (
          <div key={i} className="wf-image-placeholder aspect-square rounded-md" aria-label={item} />
        ))}
      </div>
    </div>
  );
}

// ─── Loader / splash screen ───────────────────────────────────────────────────

// Geometric approximation of the Inflight wing mark — two swept wings
// meeting at a narrow gap, pointing up, with forked prongs at bottom.
function InFlightMark({ size = 80 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.9}
      viewBox="0 0 100 90"
      xmlns="http://www.w3.org/2000/svg"
      className="text-foreground"
      fill="currentColor"
      aria-label="Inflight logo mark"
    >
      {/* Left wing — sweeps from top-center out to left, prong at bottom-left */}
      <path d="M48 6 L48 58 L36 78 L4 60 L27 53 Z" />
      {/* Right wing — mirror */}
      <path d="M52 6 L52 58 L64 78 L96 60 L73 53 Z" />
    </svg>
  );
}

function LoaderSection({ section }: SectionProps) {
  const v = (section.label ?? '').toLowerCase();
  const desc = section.contains[0] ? displayLabel(section.contains[0]) : null;

  // ── Split & Converge ──────────────────────────────────────────────────
  if (/split|converge|halve/i.test(v)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="flex items-end gap-10">
          <svg width="44" height="72" viewBox="0 0 44 90" fill="currentColor" className="text-foreground">
            <path d="M42 6 L42 58 L30 78 L0 60 L22 53 Z" />
          </svg>
          <svg width="44" height="72" viewBox="0 0 44 90" fill="currentColor" className="text-foreground">
            <path d="M2 6 L2 58 L14 78 L44 60 L22 53 Z" />
          </svg>
        </div>
        {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px]">{desc}</p>}
      </div>
    );
  }

  // ── Contrail Trace ────────────────────────────────────────────────────
  if (/contrail|trace|draw|path/i.test(v)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="relative flex flex-col items-center">
          <InFlightMark size={80} />
          <svg width="140" height="36" viewBox="0 0 140 36" className="mt-1">
            <path d="M70 0 C50 18 25 28 0 32" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" fill="none" className="text-border" />
            <path d="M70 0 C90 18 115 28 140 32" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" fill="none" className="text-border" />
          </svg>
        </div>
        {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px]">{desc}</p>}
      </div>
    );
  }

  // ── Gentle Float ──────────────────────────────────────────────────────
  if (/float|gentle|bob|drift/i.test(v)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="flex items-center gap-4">
          <svg width="32" height="8" viewBox="0 0 32 8">
            <path d="M0 4 Q8 1 16 4 Q24 7 32 4" stroke="currentColor" strokeWidth="1" fill="none" className="text-border" strokeDasharray="3 2" />
          </svg>
          <InFlightMark size={72} />
          <svg width="32" height="8" viewBox="0 0 32 8">
            <path d="M0 4 Q8 7 16 4 Q24 1 32 4" stroke="currentColor" strokeWidth="1" fill="none" className="text-border" strokeDasharray="3 2" />
          </svg>
        </div>
        {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px]">{desc}</p>}
      </div>
    );
  }

  // ── Paper Fold ────────────────────────────────────────────────────────
  if (/fold|origami|unfold|paper/i.test(v)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="relative">
          <InFlightMark size={80} />
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 90" fill="none">
            <line x1="50" y1="6" x2="50" y2="64" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 2" className="text-border" />
            <line x1="22" y1="53" x2="78" y2="53" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 2" className="text-border" />
          </svg>
        </div>
        {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px]">{desc}</p>}
      </div>
    );
  }

  // ── Pulse Ring ────────────────────────────────────────────────────────
  if (/ring|pulse|glow|radiat|expand/i.test(v)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="relative flex items-center justify-center w-[160px] h-[140px]">
          <div className="absolute w-[130px] h-[130px] rounded-full border border-border/30" />
          <div className="absolute w-[160px] h-[160px] rounded-full border border-border/15" />
          <InFlightMark size={80} />
        </div>
        {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px] -mt-4">{desc}</p>}
      </div>
    );
  }

  // ── Speed Lines (default) ─────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-5">
      <div className="flex flex-col items-center">
        <InFlightMark size={80} />
        <div className="flex gap-3 mt-2">
          {[0, 1, 2].map(col => (
            <div key={col} className="flex flex-col gap-1.5">
              {[0, 1, 2, 3].map(row => (
                <div key={row} className="w-1.5 h-3 bg-foreground rounded-full" style={{ opacity: 0.35 - row * 0.07 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      {desc && <p className="text-xs text-muted-foreground select-none text-center max-w-[180px]">{desc}</p>}
    </div>
  );
}

// ─── Map app section components ───────────────────────────────────────────────

function MapSection({ section: _ }: SectionProps) {
  return (
    <div className="wf-image-placeholder w-full min-h-[260px]" aria-label="Map" />
  );
}

function FloatingSearchSection({ section }: SectionProps) {
  const hasAvatar = section.contains.some(s => /\bavatar\b/i.test(s));
  const searchItem = section.contains.find(s => !/\bavatar\b/i.test(s));
  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex-1 flex items-center gap-2 bg-background border border-border rounded-full px-4 py-2 shadow-sm">
        <Search size={14} className="text-muted-foreground flex-shrink-0" />
        <span className="text-sm text-muted-foreground select-none flex-1">
          {displayLabel(searchItem ?? 'Search')}
        </span>
      </div>
      {hasAvatar && (
        <Avatar className="w-8 h-8 flex-shrink-0">
          <AvatarFallback className="text-xs">Me</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

function MapControlsSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col items-end gap-2 px-4 py-2">
      {section.contains.map((item, i) => (
        <Button key={i} variant="outline" size="icon" className="rounded-xl shadow-sm" title={item}>
          <HeaderIcon desc={item} />
        </Button>
      ))}
    </div>
  );
}

function CategoryStripSection({ section }: SectionProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-3">
      {section.contains.map((item, i) => (
        <Badge key={i} variant="secondary" className="whitespace-nowrap flex-shrink-0 rounded-full px-3 py-1 text-xs select-none">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function PlaceListSection({ section }: SectionProps) {
  return (
    <div className="flex flex-col">
      {section.label && (
        <div className="px-4 pt-2.5 pb-1">
          <SectionLabel>{section.label}</SectionLabel>
        </div>
      )}
      {section.contains.map((item, i) => {
        const [name, distance] = item.split('—').map(s => s.trim());
        return (
          <div key={i}>
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-xl bg-muted border border-border flex items-center justify-center flex-shrink-0">
                <MapPin size={15} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground select-none">{name}</div>
                {distance && <div className="text-xs text-muted-foreground select-none">{distance}</div>}
              </div>
              <ChevronRight size={16} className="text-border flex-shrink-0" />
            </div>
            {i < section.contains.length - 1 && <Separator />}
          </div>
        );
      })}
    </div>
  );
}

function ModalSection({ section }: SectionProps) {
  const actionItems = section.contains.filter(c => classify(c).startsWith('btn'));
  const bodyItems   = section.contains.filter(c => !classify(c).startsWith('btn'));

  return (
    <div className="w-full flex items-center justify-center">
      <div className="bg-background border border-border rounded-xl w-[85%] max-w-[280px] shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border">
          <span className="text-sm font-semibold text-foreground select-none">{section.label ?? 'Dialog'}</span>
          <span className="text-xs text-muted-foreground select-none">✕</span>
        </div>
        <div className="px-4 py-3.5 flex flex-col gap-2.5">
          {bodyItems.map((item, i) => <SmartItem key={i} label={item} />)}
        </div>
        {actionItems.length > 0 && (
          <div className="px-4 pb-3.5 pt-2.5 flex gap-2 justify-end border-t border-border">
            {actionItems.map((item, i) => <SmartItem key={i} label={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}
