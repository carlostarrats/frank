# Frank — Product Direction

Last updated: 2026-03-25

---

## Problem statement

Frank started as a passive wireframe viewer — a companion panel that renders what an AI agent writes. That was useful as a proof of concept, but it's not useful enough to be a product.

A read-only preview panel that only the AI can write to is a developer convenience, not something anyone would download. The moment you compare it to tools like Agentation (bidirectional agent feedback) or Inflight (structured design critique), a one-way viewer feels like a toy.

Meanwhile, the space between "talking about UI in a terminal" and "building real code" has no good tool:

- **Figma** requires design skills and manual creation. It's the wrong tool for AI-assisted workflows.
- **Excalidraw** is great for quick sketches but has no prototyping, no AI generation, no feedback loop.
- **Agentation** solves agent-to-human feedback on live UI, but it's single-player — no sharing, no collaboration, no prototype mode.
- **Inflight** solves design feedback beautifully, but it's locked to Figma and assumes a human designer created the artifact.
- **v0** generates real code, but there's no iteration workspace — you go straight from prompt to code with no shared visual artifact in between.

Nobody has the layer where an AI generates a visual prototype, a human iterates on it directly, shares it for team feedback, and then hands it off to become real code. That's the gap.

---

## What Frank becomes

A **persistent, interactive prototype workspace** that an AI agent can build into, a human can manipulate directly, and anyone can review via a shared link.

The prototype layer between conversation and code.

```
Conversation → Frank (iterate, prototype, share, get feedback) → Real code
```

### Who this is for

Designers and makers who work in code. People who use AI coding assistants to build UI and want to:

1. **See it fast** — get a visual preview of what you're building without publishing to GitHub, spinning up a dev server, or opening Figma. Just see the layout, instantly, alongside your terminal.
2. **Try things** — drag sections around, try a different layout, compare approaches. Interactive manipulation without writing code.
3. **Save and compare** — two ways to explore alternatives:
   - **Star (snapshot):** Pin the current state of a screen as a frozen snapshot. Keep working, try a different layout, star that too. You now have two saved states you can go back to, share independently, or compare. Stars don't branch — they're bookmarks in time on the same screen.
   - **Duplicate as variant:** Copy a screen to explore a different direction ("Dashboard" → "Dashboard — alt layout"). Both are independent screens. Work on the alt, share both links so a reviewer can experience both, keep one, delete the other.
4. **Get alignment** — share a link, get feedback from teammates or clients, approve or dismiss suggestions, then hand the agreed-upon design to the AI to build.

The gap this fills: there's no tool where an AI generates a visual prototype, you iterate on it interactively, share it for team feedback, and then hand it off as a code blueprint. Figma requires design skills. Excalidraw has no prototyping or AI generation. v0 skips the iteration and alignment step. Frank sits in the middle.

**Agent compatibility:** Frank works with Claude Code today (via Claude Code hooks and CLAUDE.md injection). But the schema format is agent-agnostic — any AI coding tool that can write a JSON file to disk can drive Frank. The project file is plain JSON, the rendering is plain HTML. Future adapters for Cursor, Windsurf, Copilot, or any other tool would only need to write to the same file path. Claude Code is the first integration, not the only possible one.

### The feedback loop that doesn't exist yet

```
AI generates screens
       ↓
You iterate in the app (drag, reorder, annotate)
       ↓
You share a link
       ↓
Reviewers comment in the browser (no app needed)
       ↓
You see feedback in your app, approve or dismiss
       ↓
AI gets the updated schema + context + decisions
       ↓
"Build this" → schema becomes the code blueprint
```

---

## What changes from today

### Today (v0 — passive viewer)

| Aspect | Current state |
|--------|--------------|
| Screens | Single wireframe, no persistence |
| Interaction | None — read-only render |
| Sharing | None — local only |
| Viewport | Scales to fill window (broken) |
| AI communication | One-way (AI → Frank) |
| Projects | None — one schema at a time |
| License | MIT |

### Tomorrow (v1 — interactive prototype workspace)

| Aspect | New state |
|--------|----------|
| Screens | Multi-screen projects with connections |
| Interaction | Drag sections, comment panel, undo/redo |
| Sharing | Links with commenting, guided feedback, cover notes |
| Viewport | Fixed device dimensions on a canvas (like Figma artboards) |
| AI communication | Bidirectional (AI ↔ Frank) |
| Projects | Multiple projects, persistent, with screen gallery |
| License | PolyForm Shield 1.0.0 |

---

## Features

### 1. Multi-screen projects

A project is a collection of screens, not a single wireframe. Each screen has:

- **Schema** — the layout (sections, content, arrangement)
- **Label** — human-readable name ("Landing Page", "Sign Up", "Dashboard")
- **Context notes** — what this screen is for, what state it represents, design decisions made. This is the killer feature for AI: the agent reads the context to pick up where it left off without needing conversation history. Free-text, not structured fields, because the AI reads and writes it naturally. Soft convention: start with purpose, then decisions, then current state — but not enforced.
- **Connections** — which elements link to which screens (hotspots for prototype navigation). Keyed by `sectionIndex:keyword` (e.g., `"0:get-started": "signup"`), not by display text. Keywords are slugified hints that survive minor text changes. The app uses fuzzy matching to resolve which item in the section is the hotspot.

**Project file format** (illustrative example — not a real project, shows the schema shape and field types):

```json
{
  "schema": "v1",
  "type": "project",
  "label": "My App Prototype",
  "savedAt": "2026-03-25T...",
  "screens": {
    "landing": {
      "label": "Landing Page",
      "platform": "web",
      "sections": [...],
      "context": "Purpose: First thing users see. Goal: get them to sign up.\nDecisions: Sara approved hero copy. Mike suggested moving CTA above fold — approved.\nState: Final.",
      "connections": {
        "0:get-started": "signup"
      },
      "notes": [
        { "id": "n1", "author": "Sara", "section": 0, "text": "Hero copy is good", "ts": "2026-03-25T...", "status": "approved" }
      ]
    },
    "signup": {
      "label": "Sign Up",
      "platform": "web",
      "sections": [...],
      "context": "Purpose: Simple email + password registration.\nDecisions: None yet.\nState: Rough draft.",
      "connections": {
        "1:create-account": "dashboard"
      },
      "notes": []
    }
  },
  "screenOrder": ["landing", "signup"],
  "activeShare": {
    "id": "a8f3k2",
    "revokeToken": "tok_x7m9...",
    "createdAt": "2026-03-25T...",
    "expiresAt": "2026-04-01T...",
    "coverNote": "Focus on the signup flow, landing page is final."
  },
  "shareHistory": [
    { "id": "prev123", "createdAt": "2026-03-20T...", "revokedAt": "2026-03-25T...", "reason": "new-version", "noteCount": 2 }
  ],
  "timeline": [
    { "type": "shared", "shareId": "a8f3k2", "ts": "2026-03-25T..." },
    { "type": "note", "author": "Sara", "screen": "landing", "section": 0, "text": "Hero copy is good", "ts": "2026-03-25T..." },
    { "type": "approved", "noteId": "n1", "ts": "2026-03-26T..." }
  ]
}
```

`screens` is an object (keyed by ID for fast lookup and stable references in connections). `screenOrder` is the authoritative display order. On every save, the app validates that `screenOrder` and `screens` keys match — any orphaned entries in either are cleaned up automatically. This prevents silent drift.

**Persistence:** The project file is saved to disk as JSON. App quits → reopen → everything is there. Agent reconnects → reads the project file → full context without re-explaining anything.

**Size:** A project with 30 screens, full context notes, and hundreds of timeline entries is roughly 200-500KB of JSON. Well within Blob upload limits and fast to read/write locally. For the share upload, this is a single small POST — no concern even on slow connections.

---

### 2. Screen gallery and flow map

The home view for a project shows all screens in two ways:

**Thumbnail grid:** Visual previews of each screen. Click one to edit it. Reorder by dragging. Add new screens.

**Flow map:** A simple node graph showing connections between screens — boxes (screens) connected by arrows (hotspot links). See the whole prototype structure at a glance without clicking into each screen. Built with the existing renderer (boxes + arrows), not a library dependency.

```
┌─────────┐       ┌─────────┐
│ Landing  │──────▸│ Sign Up │
│  Page    │       │         │
└─────────┘       └─────────┘
```

---

### 3. Prototype mode (interactive)

Define hotspots: which elements on a screen link to which other screens.

In preview mode, click through the flow like a real user would. "Get Started" button → takes you to the Sign Up screen. "Create Account" → takes you to the Dashboard. Basic click-to-navigate, like Figma prototype links.

**v1 scope:** Click → go to screen. No animations, no conditional logic, no variables.

**v2 aspiration:** Higher fidelity rendering, richer interactions.

---

### 4. Fixed viewport and canvas

**Current problem:** Wireframes scale to fill the window. This makes them look different at every window size and doesn't represent real device dimensions. This is a bug, not a feature.

**New model:** Wireframes render at fixed, real device dimensions and sit on a canvas background, exactly like Figma's artboard model.

| Platform | Default dimensions | Changeable |
|----------|-------------------|------------|
| Mobile | 390 x 844 | Yes, per screen |
| Tablet | 768 x 1024 | Yes, per screen |
| Web | 1440 x 900 | Yes, per screen |

- **Canvas background:** User-configurable color around the wireframe (default: dark neutral like `#1e1e1e`)
- **Zoom:** Fit-to-window (default, maintains aspect ratio), 100% actual pixels, custom zoom levels
- **Zoom only changes how big the wireframe appears** — never changes the wireframe's actual dimensions
- Window bigger than wireframe → canvas shows around it. Window smaller → scales down to fit.

---

### 5. App workspace UX

The app needs to feel like a structured workspace, not a preview pane.

#### Comment panel

Dedicated side panel for notes and feedback on the current screen:

- See all notes in one place
- Notes from shared reviewers appear with author name
- Approve / dismiss inline
- **Replies:** v1 replies are local only — you type a reply in the comment panel, it's stored in the project file and visible to the AI, but not sent back to the reviewer. v1+ adds threaded replies visible to reviewers (notes with a `replyTo` field pointing to another note's ID).
- Collapsible when you don't need it

#### Direct manipulation

- Drag sections to reorder them on the wireframe
- Schema updates automatically when you move things
- Agent sees the updated schema on next interaction

#### Stars (snapshots)

- Star a screen to freeze its current state as a named snapshot
- Stored as an array on the screen: `"stars": [{ "label": "Original layout", "ts": "...", "sections": [...] }]`
- Go back to any star to restore that state (pushes current state onto undo stack first)
- Share a star independently — the share uploads that snapshot, not the current working state
- Stars are lightweight: they only store the `sections` array, not the full screen metadata
- Stars live outside the undo stack — they are permanent and never roll off. The undo stack is 10 deep and ephemeral. Stars are intentional saves that only disappear if you manually delete them. Different mechanisms, different lifetimes.

#### Duplicate as variant

- Duplicate a screen to create an independent copy: "Dashboard" → "Dashboard — alt layout"
- Both are full screens in the project — separate context, notes, connections
- Share both links so a reviewer can experience and compare both approaches
- Keep one, delete the other, or keep both if they serve different flows

#### Undo / redo

- 10-state undo stack per screen
- Every action is a reversible state change: drag, approve note, delete section
- Small stack, covers any reasonable "oops" scenario

---

### 6. Bidirectional AI communication

**Today:** One-way. AI writes schema → Frank renders it. If you change something in Frank, the AI doesn't know.

**New:** Both sides read/write the same project file. No sync files, no intermediate state.

```
~/Documents/Frank/My App.frank.json    ← single source of truth
/tmp/frank/render-*.json               ← entry point for new schemas (backward compat)
```

**Protocol:**

```
AI writes new screen   → updates the project file directly → daemon detects change → forwards via WebSocket → app re-renders
User drags section     → app updates project file directly → daemon detects change → AI reads updated file on next turn
New project (no file)  → AI writes to /tmp/frank/ as today → daemon creates project file → app opens it
```

The daemon watches one location: `~/Documents/Frank/`. The `/tmp/frank/` path stays as the entry point for new schemas (backward compatible with the current flow).

**How the AI adds screens to an existing project:** The AI writes a single-screen schema to `/tmp/frank/` — the same format it uses today. The daemon detects it and, if a project is active, merges it into the project file automatically (adds the screen to `screens`, appends its ID to `screenOrder`, saves). The AI never has to read/modify/write the full project JSON itself. It only writes single screens. The daemon handles the merge.

This is important: asking the AI to manipulate a complex project JSON every time it adds a screen is error-prone. Keeping the AI's write format simple (single screen) and letting the daemon merge it into the project is cleaner and more reliable.

For edits to existing screens (updating sections, changing context), the AI reads the project file to understand current state, then writes the updated single screen to `/tmp/frank/` with a matching screen ID. The daemon detects the ID already exists and replaces that screen in the project rather than adding a new one.

**Atomic writes:** File writes aren't atomic on macOS — if both sides write at the same instant, the file corrupts. Both the app and the AI must write to a temp file first, then `rename()` into place (`rename()` is atomic on macOS/Linux). This is a one-line fix on each side but it's non-negotiable.

**Conflict rule:** Last write wins. No merge logic. Both sides watch the same file.

**Active project tracking:** The CLAUDE.md injection includes the active project file path. When you switch projects in the app, the daemon rewrites the CLAUDE.md block with the new path. This way the AI always writes to whichever project you're currently looking at. The daemon already owns the CLAUDE.md injection (it writes on `frank start`, removes on `frank stop`) — adding a path update on project switch is the same mechanism.

This is the core of "interactive." Without it, you can move things around but the AI is blind to your edits.

---

### 7. Sharing

#### Core flow

1. You hit **Share** in the app
2. Frank uploads the project JSON to a lightweight backend
3. You get a short URL: `frank.dev/s/a8f3k2`
4. You send the link to a teammate, client, or stakeholder

#### The reviewer experience (browser, no app needed)

1. They open the link — a static web page fetches the schema and renders the wireframe using the same renderer (Frank's `ui/` code is already plain HTML/CSS/JS — it runs anywhere)
2. They can click through all screens in prototype mode
3. They can click on any section and leave a note
4. First time commenting → a simple prompt asks for their name (just name, no email). Stored in localStorage. Re-asked if cleared.
5. Notes are attached to specific sections with author attribution

#### Guided feedback prompts (optional)

Alongside the free-text comment box, offer structured prompts inspired by Inflight:

- "How does this layout feel?"
- "What's missing?"
- "What would you change?"

Optional — the reviewer can ignore them and just type freely. But guided prompts produce higher quality feedback and more useful data for the conversation history.

#### Sticky note (cover note)

When sharing, you can attach an optional cover note that appears pinned at the top of the share viewer:

> "Focus on the payment screen, rest is rough."
> "This is the v2 flow — trying to reduce steps."

Sets the reviewer up to give useful feedback instead of commenting on things you already know are unfinished.

#### One active link per project

- A project has zero or one active share link at any time
- Share again → **old link dies instantly** → new link goes live
- Old link shows: "This prototype has been updated. Ask the owner for the new link."
- No stale versions, no confusion, no one looking at an outdated prototype

#### Notes persist locally, always

When a link expires or is revoked, the remote copy (schema + commenting ability) is destroyed. But all notes are already in your local project file. They stay until you explicitly delete them.

**Note sync mechanism:** Every time the app polls for new notes (every 30-60s while open), it writes any new notes into the `.frank.json` project file immediately. On app launch, the app checks all active shares and pulls any notes that arrived while it was closed. The project file is always the complete record — the remote is just the live collaboration surface.

#### Conversation history / timeline

Every note, reply, approval, dismissal is logged as a timeline on the project:

```
Mar 25  You shared (link: a8f3k2, expires Apr 1)
Mar 25  Sara: "Add conversion rate to stats row" [on Stats Row]
Mar 26  You approved "Add conversion rate" → schema updated
Mar 27  You dismissed "Status column" with note: "Out of scope for v1"
Apr 1   Link a8f3k2 expired
Apr 2   You shared (link: k9m2x7, expires Apr 9)
```

History never auto-deletes. Only the user can delete it. This is the design decision record — what got approved, what got rejected and why, who said what. Long-term, this data captures how a team makes design decisions and could feed process intelligence, agent training, or team analytics.

#### Security (layered)

| Level | Feature | When |
|-------|---------|------|
| v1 | Unguessable link ID (12+ random chars), not sequential | Launch |
| v1 | Link auto-expiry (default 7 days) | Launch |
| v1 | Re-share kills the old link immediately | Launch |
| v1+ | Password-protected links | Soon after |
| v2 | View-only vs can-comment permissions | When sharing gets nuanced |

#### Abuse protection

The `POST /api/note` endpoint is unauthenticated (by design — reviewers don't need accounts). Basic limits prevent abuse:

- Max 100 notes per share (hard cap — after that, commenting is disabled)
- Max 5 notes per minute per IP (rate limit)
- Max note length: 2,000 characters

These are checked in the serverless function before writing to Blob. No additional infrastructure needed.

#### Expired share cleanup

Expired shares are cleaned up lazily, not by a cron job:

- `GET /api/share/[id]` checks expiry on read. If expired, it returns the "expired" message and queues a delete of all blobs under that share prefix (schema + meta + all notes). The delete happens in the same request using `waitUntil` so it doesn't slow down the response.
- **Safety net:** If nobody visits an expired link, its blobs stay. A monthly Vercel cron (`/api/cleanup`) lists all `meta.json` blobs, checks expiry dates, and deletes expired share prefixes. This is cheap (one list operation + deletes) and prevents unbounded accumulation over time. Not needed at launch — add when there are enough shares for it to matter.

#### Backend architecture

**Vercel only. No database for v1.**

The data model is tiny — a shared prototype is one JSON blob plus an array of notes. Vercel Blob handles all storage. Vercel serverless functions handle the API. The viewer is a static HTML page (the existing `ui/` renderer + a fetch call) deployed to Vercel.

**Storage:** Vercel Blob — one blob per artifact, no read-modify-write

```
shares/a8f3k2/schema.json           → the full project JSON
shares/a8f3k2/meta.json             → expiry, cover note, revocation status
shares/a8f3k2/notes/note-001.json   → { author, section, text, timestamp }
shares/a8f3k2/notes/note-002.json   → each note is its own blob
shares/a8f3k2/notes/note-003.json   → no race conditions, no lost writes
```

Each note is a separate blob. Write = create new blob (append-only, no conflicts). List = Vercel Blob prefix listing. This eliminates the race condition where two reviewers comment at the same time.

**API:** Three serverless functions

```
POST /api/share        → receives project JSON + cover note + expiry
                       → if activeShare exists in the project JSON, validates the revokeToken matches the server's stored token — then revokes old share
                       → generates unguessable random ID (12+ chars) + a revokeToken (random secret)
                       → stores schema.json + meta.json (including revokeToken hash) to Blob
                       → returns short URL + new share ID + revokeToken (app writes both into activeShare)

POST /api/note         → receives share ID + section index + author name + text
                       → validates share exists and hasn't expired
                       → creates new note blob (no read-modify-write)
                       → returns the created note

GET  /api/share/[id]   → lists all blobs under the share prefix
                       → returns schema + all notes + cover note + metadata
                       → or "expired/revoked" message with explanation
```

**Viewer:** Static HTML page deployed to Vercel. Fetches schema from the API, renders using the same `ui/` renderer code. Zero server-side rendering — everything happens in the reviewer's browser.

**Notification polling:** The desktop app polls `GET /api/share/[id]` periodically to check for new notes. Lightweight — it's just fetching a JSON blob. Could upgrade to SSE in v2 if polling latency matters.

**Cost:** Vercel free tier covers it. Blob gives 1GB free, serverless functions give 100GB-hours free. The payload is tiny (2-50KB per share). Thousands of active shares wouldn't approach the limits. No database cost, no Redis cost, no infrastructure to manage.

**When to add a database:** Only if you need to query across shares (analytics, search, team dashboards). At that point, add Upstash Redis via Vercel Marketplace for metadata and keep Blob for schema/note storage.

---

### 8. Multiple projects

Home screen / project picker:

- Open recent projects
- Create new project
- Archive old projects
- Each project listed with: name, last modified, screen count, thumbnail of first screen
- Each project is its own `.frank.json` file on disk
- No limit on number of projects

**Storage location:** `~/Documents/Frank/` — flat folder, no nesting, obvious for the user.

```
~/Documents/Frank/
├── My App Prototype.frank.json
├── Dashboard Redesign.frank.json
└── Onboarding Flow.frank.json
```

The `.frank.json` extension signals it's a Frank project file while remaining valid JSON that any editor can open.

---

### 9. Export

Get wireframes out of Frank for use elsewhere:

- **PNG** — for Slack messages, emails, quick shares
- **PDF** — for decks and presentations
- **Standalone HTML** — a self-contained file someone can open in a browser
- Export the current screen or the full project (all screens as multi-page PDF or image set)

DOM-to-PNG is already referenced in the architecture. This needs to be a first-class feature, not an afterthought.

---

### 10. "Build this" handoff

The payoff of the entire tool. When you say "build this", the transition from wireframe to code should feel intentional.

**The handoff view is for the human, not the agent.** The agent already reads the project file directly — it doesn't need a special format. The handoff view is your checkpoint before giving the go-ahead:

- All screens laid out with their context notes visible
- Reviewer feedback shown per screen: approved, dismissed, still pending
- Connections visualized (the flow map)
- A summary line: "8 screens, 3 with unresolved notes, 2 connections undefined"

You look at this, confirm everything is resolved, then tell the agent "build this." The agent reads the project file as-is — the schema, context, connections, and decision history are already structured for it.

Each screen's context notes carry the design decisions and feedback into the build phase. The agent doesn't just know the layout — it knows *why* it's that layout and what the team agreed on.

---

### 11. Notifications for incoming feedback

When a reviewer leaves a note on a shared prototype, the app needs to surface it.

- **In-app badge only** — a dot/indicator on the project in the home screen, and on the comments panel when inside the project. No OS-level notifications, no sounds, no popups.
- The app polls `GET /api/share/[id]` periodically (every 30-60 seconds when the app is open) to check for new notes.
- You see it when you look, not when you don't. Subtle, non-interruptive.

---

### 12. Offline-first

Creating, editing, prototyping, saving — all work without internet. Only sharing (upload, download, notes sync) requires a connection.

This is an explicit architectural requirement. The project file on disk is always the source of truth.

---

## Architecture changes required

### Schema evolution

The v1 schema (`type: "screen"` and `type: "flow"`) needs to expand to support:

- `type: "project"` — multi-screen container with metadata
- Screen IDs (not just labels) for stable references
- `context` field per screen (for AI memory)
- `connections` map per screen (for prototype hotspots)
- `notes` array per screen (for feedback)
- `timeline` array on the project (for conversation history)
- `activeShare` object (for sharing state)
- Viewport dimensions per screen (width, height)

Backward compatibility: existing `screen` and `flow` schemas should still render. The project type is a new container around them.

### App structure

The app goes from a single-pane renderer to a workspace with multiple views:

| View | What it shows |
|------|--------------|
| **Home** | Project picker — recent projects, create new |
| **Gallery** | All screens in a project — thumbnails + flow map |
| **Editor** | Single screen — wireframe + comment panel + toolbar |
| **Preview** | Prototype mode — click through the flow |
| **Handoff** | Developer-friendly view of the full project |

### Daemon / backend

| Component | Today | Tomorrow |
|-----------|-------|----------|
| File watcher | Watches `/tmp/frank/` for new schemas | Also watches project files for bidirectional sync |
| WebSocket | One-way (daemon → app) | Bidirectional (daemon ↔ app) — user edits flow back |
| Share backend | Doesn't exist | Vercel Blob + 3 serverless functions + static viewer (see §7 Backend architecture) |

### Renderer

The `ui/` rendering engine (section renderers, smart-item classifier, icons, CSS) is plain HTML/CSS/JS with no build step. This is the key architectural advantage — the same rendering engine runs in every context.

However, each context needs a different shell around the engine:

| Context | Data source | Navigation | Extra UI |
|---------|------------|------------|----------|
| **Tauri app** | WebSocket from daemon | Tab bar, gallery, editor views | Comment panel, drag handles, toolbar, undo |
| **Share viewer** | Fetch from API (`GET /api/share/[id]`) | Screen nav bar, prototype click-through | Commenting overlay, name prompt, guided prompts |
| **Terminal pane (future)** | File watcher or WebSocket | Minimal — single screen | None |

The rendering engine (`sections.js`, `smart-item.js`, `icons.js`, `style.css`) is shared across all three. The shell code (data fetching, navigation, interactive UI) is different per context. "Same engine, different shell" — not "identical code everywhere."

### Persistence

| Today | Tomorrow |
|-------|----------|
| No persistence — schemas are ephemeral `/tmp` files | Project files saved to disk as JSON |
| App quits → everything lost | App quits → reopen → everything there |
| Agent loses context between sessions | Agent reads project file → full context |

---

## Licensing

**Decision: PolyForm Shield 1.0.0**

- Source available — anyone can read the code
- Free to use — always, no restrictions on usage
- Protected — nobody can clone it to build a competing product or service
- Same license Agentation uses

**Why not MIT (current)?** Someone could take the renderer, schema format, and sharing protocol and launch a competing hosted service. MIT offers no protection. With a sharing backend as a core feature, the source code needs protection even though usage stays free.

**Timing:** Switch from MIT to PolyForm Shield before shipping sharing features and before accepting external contributions. Changing licenses after contributors submit code under MIT gets legally messy.

---

## Competitive landscape

### Agentation (agentation.com)

Desktop tool for agent-to-human feedback on live UI. Click elements, annotate with CSS selectors and source paths, feed annotations back to the AI agent. Licensed under PolyForm Shield.

**What it has that Frank doesn't:** Bidirectional agent communication, annotation on live rendered UI, CSS selector extraction.

**What it doesn't have:** Sharing, collaboration, prototype mode, wireframe generation, persistence, team feedback. Single-player only.

**Relationship:** Different niche. Agentation is feedback on existing UI. Frank is generating and iterating on new prototypes. Complementary, not competitive.

### Inflight (inflight.co)

Design feedback tool for Figma users. Export frames, add voiceover, get structured critique through guided prompts. Funded (seed stage).

**What it has that Frank doesn't:** Guided feedback prompts (Frank will adopt this), structured critique methodology, Loom integration.

**What it doesn't have:** AI generation, prototype mode, agent integration. Locked to Figma ecosystem. Requires a human designer to create the artifact.

**Relationship:** Validates that feedback-on-design-artifacts is a real market. Frank's guided prompts are inspired by Inflight but the rest of the product is different.

### Figma

Full design tool with prototyping and collaboration. Industry standard.

**Relationship:** Frank is intentionally not Figma. Low-fi, agent-driven, no design skills needed. Frank exists for people who don't open Figma — they talk to an AI and get a visual prototype.

### v0 (v0.dev)

AI-generated production code from prompts. GitHub integration, one-click deploy.

**Relationship:** v0 goes from prompt to code. Frank goes from prompt to prototype to feedback to code. Frank is the iteration and alignment step that v0 skips.

### Position

Frank's niche: **the prototype layer between conversation and code.** AI builds screens, you click through them like a user would, share them for team feedback, and when the design is right, you say "build this" and the schema becomes the blueprint.

No other tool does this. The feedback loop — AI generates → human iterates → team reviews → AI builds — doesn't exist anywhere else.

---

## Design principles

### Everything looks polished

Non-negotiable. Every surface of Frank must look like a real product: wireframe rendering, app chrome (gallery, comments, toolbar), the share viewer, the flow map, feedback prompts.

If the tool looks bad, nobody trusts what it produces. Competitors treat visual quality as a feature. Frank must match or exceed that bar. No developer UI, no debug aesthetics, no clunky forms.

### Speed above all

The wireframe renderer is already fast (<5ms). That standard applies to everything: screen switching, project loading, share link generation, feedback display. Frank should feel instant.

### Offline by default

Everything works without internet except sharing. The project file on disk is always the source of truth. Network is an enhancement, not a requirement.

### Schema is the source of truth

One schema drives everything: the wireframe render, the prototype navigation, the share viewer, the handoff view, the export. There is no second representation of the design.

---

## Resolved decisions

Decisions made during the design process, captured here for reference:

| Question | Decision | Rationale |
|----------|----------|-----------|
| Backend technology | Vercel Blob + serverless functions, no database | Data model is tiny JSON blobs. No query needs. Free tier covers it. |
| Note storage | One blob per note (append-only) | Eliminates race conditions when multiple reviewers comment simultaneously |
| Connection keys | `sectionIndex:keyword` format with fuzzy matching | Display text is fragile (changes on regeneration). Index + slug is stable enough. |
| Context field format | Free-text with soft convention (Purpose/Decisions/State) | AI reads and writes it naturally. Rigid schema would fight the workflow. |
| Bidirectional sync | Single project file, both sides read/write directly | No sync files, no intermediate state, no third location. Daemon watches one folder. |
| Handoff view | For the human (checkpoint before "build this"), not the agent | Agent already reads the project file. Handoff is a review moment, not a format conversion. |
| Notifications | In-app badge only, polling every 30-60s | No OS notifications. Subtle, non-interruptive. You see it when you look. |
| Project file location | `~/Documents/Frank/*.frank.json` | Obvious, accessible, user-friendly. Flat folder, no nesting. |
| Privacy model | Local by default, opt-in sharing | README must update from "no data leaves your machine" to "no data leaves unless you hit Share" |
| Note sync to local | Pull on poll + pull on app launch | Notes written to project file immediately on receipt. On launch, check all active shares for missed notes. |
| Abuse protection | Rate limits + caps in the serverless function | Max 100 notes/share, 5 notes/min/IP, 2,000 char limit. No extra infra. |
| Screen order integrity | Auto-validate `screens` keys match `screenOrder` on every save | Prevents silent drift between the object and the order array. |
| File write safety | Atomic writes via temp file + `rename()` | Prevents corruption when AI and app write at the same instant. |
| Active project tracking | Daemon rewrites CLAUDE.md injection with current project path on switch | AI always writes to whichever project the user is looking at. |
| Expired share cleanup | Lazy deletion on read + monthly cron safety net (add later) | Lazy handles 99% of cases. Cron prevents unbounded accumulation. |
| Agent compatibility | Claude Code first, schema is agent-agnostic | Any tool that writes JSON to a file path can drive Frank. Claude Code is the first integration. |
| AI screen creation | AI writes single screens to `/tmp/frank/`, daemon merges into project | AI never manipulates the full project JSON. Simple write format, reliable merge. |
| Share revocation auth | `revokeToken` generated at share time, validated on revocation | Prevents anyone who guesses a share ID from revoking someone else's link. |
| Replies | v1: local only (visible to you + AI). v1+: threaded, visible to reviewers | Keeps v1 simple. `replyTo` field on notes enables threading later. |
| Renderer architecture | Same rendering engine, different shell per context | Sections/icons/CSS shared. Data fetching, nav, and interactive UI differ per context. |
| Version exploration | Stars (snapshots) + duplicate as variant — no formal versioning system | Stars for "try and maybe revert." Duplicate for "two genuinely different approaches to share independently." |

## Open questions

These still need answers before or during implementation:

- **Terminal-native embedding:** Could Frank live as a terminal pane (Ghostty plugin, WezTerm pane, Kitty kitten) instead of / in addition to a standalone app? The renderer is portable HTML — it could live anywhere that hosts a webview. Worth investigating as terminal plugin APIs mature.
- **Hotspot definition UX:** The schema format is decided (`sectionIndex:keyword`). But the in-app UX isn't — does the user click an element and pick a target screen from a dropdown? Does the agent define all connections and the user just reviews? Both?
- **Drag granularity:** Section-level drag (reorder sections) is clear for v1. Item-level drag within a section (reorder buttons in a form) is more granular and harder — is it needed?
- **v2 fidelity:** What does "higher fidelity" mean specifically? More realistic component rendering? Color theming? Custom fonts? This needs definition before v2 work starts.
- **Share link domain:** `frank.dev/s/[id]`? Need to secure a domain. Or start with a Vercel subdomain (`frank-share.vercel.app/s/[id]`) and move to a custom domain later.

---

## What stays the same

Not everything changes. These fundamentals hold:

- **Tauri shell** — native macOS window, Cmd+Shift+L hotkey, minimal Rust surface area
- **Plain JS renderer** — no build step, no framework, no dependencies. HTML string templates + CSS.
- **Claude Code hooks** — PostToolUse file watcher is the interception method. No TTY reading, no process wrapping. The hook system stays, but its scope grows: today it watches `/tmp/frank/` for new schemas; tomorrow it also needs to know which project is active so the AI writes to the correct project file. The CLAUDE.md injection handles this by including the active project path.
- **Schema-first architecture** — one schema drives all rendering and export
- **Mac-first** — ship tight for Mac, cross-platform later
- **Local by default** — Frank works entirely on your machine. No accounts, no telemetry, no analytics. When you choose to share a prototype, the project schema and reviewer notes are stored on Vercel's infrastructure. No data is transmitted unless you explicitly hit Share. The README's privacy statement needs updating from "no data leaves your machine ever" to reflect this opt-in model.
- **Daemon architecture** — Node.js CLI + file watcher + WebSocket server. It works. No reason to rewrite it.
