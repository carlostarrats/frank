# Frank — Progress

Last updated: 2026-03-31

---

## Timeline

### v0 — Wireframe renderer (Feb-Mar 2026)

Frank started as "Looky Loo" — a terminal companion that renders wireframes from JSON schemas in a native Tauri panel. Built with React + TypeScript + shadcn + Tailwind + Vite. Worked but the build pipeline was heavy and fragile.

Pivoted to plain JS (no framework, no build step). Rebuilt the entire frontend as plain JavaScript ES modules. 30+ section renderers, device frames, design intelligence in CLAUDE.md.

### v1 — Interactive workspace (Mar 2026)

Rebuilt as a multi-view workspace: home (project picker), gallery (screen thumbnails + flow map), editor (zoomable canvas + comments). Added project persistence (`.frank.json` files), drag-to-reorder sections, sharing with commenting, guided feedback prompts, cover notes, export (PNG, HTML, PDF), prototype preview mode, handoff view. Merged to `main`.

### v2 — Collaboration layer (Mar 2026)

**Pivoted from wireframe tool to collaboration layer for any web content.**

Why: wireframes are a relic of the Figma era. People build with real code now. The value isn't in rendering wireframes — it's in the collaboration layer: commenting on specific elements, sharing for feedback, routing feedback to AI, and capturing the decision chain.

What changed:
- Input is a URL (or file), not a JSON schema
- Content wraps in an iframe with a commenting overlay
- Smart element detection (clicks bubble to meaningful elements)
- Triple-anchor comment system (CSS selector + DOM path + coordinates)
- Self-hosted cloud sharing (Vercel template users deploy themselves)
- Feedback curation (approve/dismiss/remix before sending to AI)
- AI routing (structured clipboard copy with context)
- Snapshots with starring
- Timeline view
- Structured JSON export of the complete decision-making process

---

## What's done (v2)

### Phase 1 — Foundation
- [x] Daemon v2: protocol types, project model (`~/.frank/`), content proxy, server rewrite, CLI
- [x] Browser UI: app shell, home view, iframe viewer with proxy fallback
- [x] Commenting overlay: smart element detection, triple-anchor, highlight rendering
- [x] Multi-page tracking: detect iframe navigation, prompt to add screens
- [x] Bug fixes: overlay click detection (pointer-events), comment input in curation panel

### Phase 2 — Cloud sharing
- [x] Frank Cloud: Vercel template with share/comment/health API endpoints
- [x] Share viewer: static page rendering snapshots with commenting + guided prompts
- [x] Daemon: cloud client, DOM snapshot capture, share upload, comment sync (30s polling)
- [x] UI: share popover with cover notes, snapshot capture + sensitive content detection
- [x] CLI: `frank connect`, `frank status`

### Phase 3 — Data capture + curation
- [x] Daemon: snapshot storage, curation log, AI interaction chain, structured export
- [x] UI: curation panel (approve/dismiss/remix/batch with status badges)
- [x] UI: AI routing modal (editable instruction + clipboard copy)
- [x] UI: timeline view with snapshot/comment entries + JSON export button
- [x] CLI: `frank export`

---

## What's not done

### Testing & polish
- [ ] Full end-to-end test with a real localhost dev server
- [ ] Test share flow with deployed Frank Cloud instance
- [ ] Test with complex real-world sites (multi-page SPAs, heavy JS apps)
- [ ] Fix: proxy URL change triggers false multi-page nav prompt
- [ ] Polish: loading states, error handling, edge cases

### Cloud deployment
- [ ] Test "Deploy to Vercel" button flow end-to-end
- [ ] Verify Vercel Blob storage provisioning
- [ ] Test comment sync between cloud and local

### Future
- [ ] Direct AI integration (CLAUDE.md injection instead of clipboard)
- [ ] Tunnel mode for localhost sharing (live instead of snapshot)
- [ ] Real-time comment updates (SSE instead of polling)
- [ ] PDF/image file input support (UI for drag-and-drop)
- [ ] Snapshot starring UI in timeline
- [ ] Backup to cloud (`frank backup`)

---

## Key decisions

| Decision | Why |
|----------|-----|
| URL wrapping over wireframes | People build with real code. The value is collaboration, not rendering. |
| Self-hosted cloud | Users own their data. No SaaS, no vendor lock-in. |
| iframe + overlay | Non-invasive — Frank doesn't modify the content, just adds a layer on top. |
| Smart element detection | Reviewers aren't precise. Clicks should target cards and buttons, not tiny spans. |
| Triple-anchor comments | CSS selectors break when code changes. Fallback chain ensures comments survive. |
| Clipboard AI routing | Works with any AI tool. Direct integration comes later. |
| Always-on data capture | Can't go back and capture what you didn't record. Toggle off per project if needed. |
| Plain JS, no build step | Fast iteration, zero toolchain friction. |
| Daemon sole file writer | Single source of truth, atomic writes, no corruption. |
