# Looky Loo — Product Proposal v1

> "See what you're building."

---

## Overview

Looky Loo is an open source terminal companion tool for developers working with AI coding assistants. It sits alongside your terminal session and automatically renders visual output — wireframes, screen layouts, and UI flows — in a lightweight companion panel, without interrupting or duplicating anything in the terminal itself.

It is not a browser extension. Not an IDE plugin. Not a full desktop application. It is a lightweight, invisible observer that surfaces visual context exactly when it is useful and disappears when it is not.

The core problem it solves: when working in Claude Code or any AI coding tool, visual output — layouts, component structures, screen designs — is described in text. Reading that text and mentally constructing the visual is slow and error-prone. Looky Loo renders that visual automatically, instantly, and accurately, so you can react to it conversationally and keep building.

---

## Principles

- **Zero friction.** Nothing to configure. Nothing to prompt. It just works alongside your existing workflow.
- **Zero cost.** Piggybacks on the user's existing AI coding session. Makes no independent API calls. No usage fees, no tokens consumed.
- **Zero data collection.** Reads only the local terminal output stream. Nothing is sent anywhere. Privacy is a first-class design decision, not an afterthought.
- **Static only.** Renders snapshots, not interactions. This is intentional. Static layouts are bounded, predictable, and schema-safe.
- **Schema first.** Every render is driven by a structured data schema. The panel and all exports consume the same schema. What you see is always exactly what gets exported.
- **Mac first, v1.** Cross-platform is a future consideration. Ship tight and right for Mac first.
- **Open source, always.** Not a business. A contribution. The technology is moving too fast to gatekeep something like this.

---

## What It Is Not

- Not interactive. No clickable prototypes. No hover states. No conditional UI.
- Not a design tool replacement. It is a quick visual layer for direction, not for production design handoff.
- Not a browser tab or web app.
- Not an IDE extension.
- Not a Claude Code plugin (no official plugin system exists yet). It is a standalone companion.
- Not persistent across terminal sessions. Tabs and renders clear when the session ends.

---

## Target User

Developers and designer-developers working with AI coding assistants — primarily Claude Code — who want to see a quick visual representation of UI layouts and flows without leaving their terminal workflow or opening a design tool.

Primary user for v1: the builder of this tool. Solve your own problem first.

---

## Technical Stack

| Layer | Technology |
|---|---|
| Companion panel | Tauri (native window, no Electron, no browser engine) |
| Panel UI | React + Shadcn/Radix primitives |
| Wireframe rendering | React components, React Flow for hierarchy/flow structures |
| Output interception | Claude Code hooks system (PostToolUse, session events) |
| Panel/daemon communication | Local socket |
| Export: image | DOM-to-PNG (scoped to wireframe component only) |
| Export: MCP | Reads user's locally installed MCP servers dynamically |
| Distribution | npm or Homebrew, single install command |

---

## Architecture

### Core Flow

```
Claude Code output stream
         ↓
  Output interceptor daemon
         ↓
  Classification layer
  (is this render-worthy?)
         ↓
  Schema generation
  (structured layout data)
         ↓
  Local socket → Tauri panel
         ↓
  React renders from schema
         ↓
  Export consumes same schema
```

The schema is the single source of truth. The panel renders from it. Every export sends it. There is no separate rendering path and no separate export path. Consistency is guaranteed by design.

### Output Interceptor

**Implementation: Claude Code hooks system.**

Claude Code exposes hooks for tool calls and session events (e.g. `PostToolUse`). Looky Loo registers hooks that fire after Claude Code produces output, classifying and forwarding render-worthy content to the panel via local socket.

This is the intended extension point. It is more stable than TTY/pty reading (fragile, breaks with terminal resizing and signals) and avoids the edge cases of process wrapping (signal propagation, interactive input, terminal sizing). If hooks prove insufficient for a specific use case, the fallback is child process wrapping — but hooks are the starting point and expected to be sufficient for v1.

### The Invisible Prompt Wrapper

**Implementation: `~/.claude/CLAUDE.md` injection.**

On install, Looky Loo appends a clearly delimited block to the user's `~/.claude/CLAUDE.md` file (creating it if it does not exist). This block is the system prompt that instructs Claude Code to signal render-worthy output in schema-friendly structure. On uninstall, the block is removed cleanly. The user never touches it manually.

It nudges Claude Code to:

- Signal when output is render-worthy
- Output layout descriptions in a schema-friendly structure
- When generating multiple screens, establish the full flow and shared design language before generating individual screens
- Think sequentially and holistically across multi-screen flows

This wrapper is the intelligence layer. It requires no user action and costs nothing extra.

### Classification Rules (v1)

To ship fast and maintain trust, the classification layer in v1 is deliberately conservative. Only render when output contains clear structural signals:

- A recognizable page or screen layout description
- An explicit component or section list
- A pattern that maps cleanly to a known layout type
- Output that describes a single frozen moment of a UI (no conditional states, no interaction descriptions)

If confidence is below threshold, pass through as clean formatted text. Never attempt a render that might be wrong. A tool that renders five things perfectly is more trusted than one that attempts twenty and gets some wrong.

---

## The Schema

The schema is a structured JSON description of a layout or flow. It is the contractual layer between Claude Code's output and every downstream consumer (panel, Figma, Notion, PNG export, context paste).

### Single Screen Schema (simplified)

```json
{
  "schema": "v1",
  "type": "screen",
  "label": "Home Screen",
  "timestamp": "2025-03-03T14:34:00",
  "platform": "mobile",
  "sections": [
    {
      "type": "header",
      "contains": ["logo", "navigation", "user avatar"]
    },
    {
      "type": "hero",
      "contains": ["headline", "subheadline", "CTA button"]
    },
    {
      "type": "content",
      "contains": ["card", "card", "card"]
    },
    {
      "type": "bottom-nav",
      "contains": ["home", "search", "profile", "settings"]
    }
  ]
}
```

### Multi-Screen Flow Schema (simplified)

```json
{
  "schema": "v1",
  "type": "flow",
  "label": "Onboarding Flow",
  "timestamp": "2025-03-03T14:34:00",
  "design_language": {
    "nav_position": "bottom",
    "header_style": "minimal",
    "card_style": "rounded-lg shadow-sm",
    "spacing": "comfortable"
  },
  "screens": [
    { "label": "Welcome", "sections": [...] },
    { "label": "Create Account", "sections": [...] },
    { "label": "Set Preferences", "sections": [...] },
    { "label": "All Done", "sections": [...] }
  ]
}
```

The `design_language` object at the flow level is what keeps all screens coherent. Every screen inherits from it. This is what ensures a four-screen onboarding flow feels like one product rather than four unrelated screens.

### Schema Versioning

The schema is versioned from day one (`"schema": "v1"`). Breaking changes are managed through version increments. Anyone building on top of the schema can target a specific version. This is a non-negotiable architectural decision even in v1.

---

## The Panel

### Tauri Layer Philosophy

The Tauri shell is infrastructure, not application logic. The Rust layer does exactly two things: opens the native window and runs the local socket listener. All rendering, tab management, schema consumption, export logic, and UI behavior lives in React. This keeps the Rust surface area minimal and the codebase accessible without Rust expertise. Tauri's default scaffolding covers the shell; the React layer is where investment goes.

### Window Behavior

- **No dock icon.** No menu bar presence. No app switcher entry.
- **Invisible by default.** The panel does not exist visually until there is something to render.
- **Auto-shows** when a render-worthy output is detected. Appears with a smooth ease-in animation. Never snaps or flashes.
- **Never auto-dismisses.** The user closes or hides the panel on their own terms.
- **Hide, not close.** The panel has a Hide button, not a Close button. Hiding preserves all tabs for the life of the session. Tabs are only cleared when the terminal session ends.
- **Hotkey recall.** A system-level hotkey (e.g. `Cmd+Shift+L`) shows or hides the panel from anywhere on the desktop, regardless of which app has focus.
- **Session-scoped.** When the terminal session ends, all tabs clear. Every session starts fresh. No persistence, no storage, no privacy concerns.
- **Positioned independently.** The panel is a free window the user positions to their preference. Recommended placement is alongside the terminal but not enforced.

### Appearance

- Dark and light mode aware. Reads system appearance and matches it.
- Minimal, neutral aesthetic. Does not try to mimic any specific terminal's visual style.
- Feels like a utility panel, not an application.
- Wireframe visual language: gray fills, subtle borders, clean sans-serif labels, intentionally low fidelity. Feels like Balsamiq or Whimsical's wireframe mode -- designed to look unfinished, not accidentally broken.

---

## Tab System

### Behavior

- Each render generates a new tab.
- Tabs appear one by one for multi-screen flows, in sequence, as each screen is generated.
- Tab order reflects generation order and implicitly represents flow sequence.
- No auto-dismiss. Tabs persist until session end or manual panel close.
- Tabs are the navigation system. No additional flow controls needed in v1.

### Tab Label

- Inferred from schema content. Not "Render 1, Render 2."
- Examples: "Home Screen", "Dashboard Layout", "Auth Flow", "Onboarding -- Screen 2"
- During loading: placeholder label ("Screen 2...") updates in place to real label when schema has enough signal.

### Tab Timestamp

- Displayed at the top of each tab's content area, not just in the tab label.
- Same day: "2:34 PM"
- Different day: "Mar 2, 2:34 PM"
- Always absolute time. Never relative ("2 hours ago"). Relative time requires mental math. Absolute time is instant to read.
- Handles multi-day sessions (terminal left running overnight) correctly from day one.

### Tab States

Each tab has three states:

1. **Loading** -- spinner visible in the tab label area
2. **Complete** -- label and timestamp visible, spinner gone
3. **Active/selected** -- content visible in panel body

---

## Loading Experience

### Tab Bar During Generation

- Tabs appear one by one as each screen's generation begins
- Each tab shows a subtle spinner while its screen is being generated
- Spinner resolves to label when render is complete
- User can click any tab at any point, including mid-generation

### Tab Content During Loading

Clicking a loading tab never shows an empty panel. Instead it shows a skeleton screen:

- Two skeleton variants:
  - **Mobile skeleton** -- centered narrow layout, top bar, content blocks
  - **Web skeleton** -- full width, top nav, sidebar, main content area
- Correct skeleton variant is selected from early schema signal (platform type is output early)
- Skeleton blocks have a subtle pulse animation
- When render is complete, skeleton crossfades to the actual wireframe

The crossfade from skeleton to render is a deliberate, considered moment. It signals completion clearly and feels polished. This is the interaction detail that separates a fast build from a quality build.

---

## Multi-Screen Flow Generation

When Claude Code generates a multi-screen flow (e.g. "mock up an onboarding flow"):

1. Claude Code first establishes the full flow structure and shared design language (via invisible prompt wrapper)
2. Screens are generated sequentially, each informed by the previous and adherent to the shared design language
3. Tabs appear one by one in the panel as each screen begins generating
4. Each tab shows skeleton while loading, crossfades to render when complete
5. All tabs share the same design language object from the flow schema -- nav position, header style, card style, spacing are consistent across every screen
6. The completed tab sequence is the flow. Reading tabs left to right tells the full user journey.

---

## Empty / Idle State

When the panel is open but no renders have been generated yet (start of session, or between renders):

- Displays rotating ambient phrases. Calm, minimal, alive without being noisy.
- Examples: "Watching.", "Ready.", "On deck.", "Listening.", "Standing by."
- Inspired by Claude Code's own idle state treatment.
- Never feels broken or empty. Always feels intentional.

---

## Export Features

### Save as PNG

- Button on each tab content area
- Exports only the wireframe component, not the full panel chrome
- Clean output: white or dark background matching panel theme, consistent padding, tab label and timestamp baked into image header
- Image format:

```
Looky Loo  --  Home Screen
Mar 3, 2025  2:34 PM

[wireframe render]
```

- Looks like a proper wireframe artifact from a design tool, not a random screenshot
- Suitable for dropping into Slack, meeting decks, Jira tickets, or emails

### Export as Context

- Button on each tab
- Copies the tab's schema as clean structured JSON or formatted text to clipboard
- Paste directly into Claude Code as context: "Here's the wireframe we landed on, build from this"
- Claude Code receives full structured layout intent, not a vague description

### Export via MCP

- Reads the user's locally installed MCP servers dynamically
- Export menu is built from what is actually available -- no hardcoded destinations
- If user has Figma MCP: Figma appears as an option
- If user has Notion MCP: Notion appears
- If user has no MCP servers: only PNG and Copy as Context are shown
- No configuration required. Reflects reality automatically.
- For multi-screen flows, exports the full flow as an ordered sequence with the flow label and design language intact -- not just individual frames
- As the MCP ecosystem grows, new design tools become available automatically without any changes to Looky Loo

### Export Consistency Guarantee

Every export path -- PNG, context copy, MCP -- consumes the identical schema that drove the panel render. There is no separate interpretation step. What you see in the panel is exactly what every export destination receives. This is the most important trust guarantee the tool makes. Inconsistency here is a one-and-done failure.

---

## Text Rendering (Secondary Feature)

For long-form text output from Claude Code -- explanations, documentation, structured reasoning -- Looky Loo can render it as readable formatted text rather than a wall of raw terminal output.

This is a secondary feature, not the core. It only activates for clearly text-heavy outputs where formatting adds real readability value. It does not activate for all text. The user stays in their terminal for normal output.

When it does render:
- Clean paragraph hierarchy
- Headlines and subheadlines with visual weight
- Readable line length and spacing
- Same font as the rest of the panel -- no custom typography needed, just structure and spacing

This feature exists so users never have to jump to a browser just to read a Claude Code text output in a formatted way. Convenience, not a primary use case.

---

## Installation and Distribution

```bash
# Via Homebrew (preferred for Mac)
brew install lookyloo

# Via npm
npm install -g lookyloo

# Run
lookyloo start
```

- Single command install
- Single command to start
- No configuration file required to get started
- Optional config for hotkey customization
- No account, no login, no API key

From Claude Code's perspective: nothing changes. Looky Loo observes silently. The user runs Claude Code exactly as they always have.

---

## Privacy and Security

- No data leaves the machine. Ever.
- No telemetry. No analytics. No crash reporting unless explicitly opted in.
- The tool reads the local terminal output stream only.
- No account required. No network calls except MCP exports initiated explicitly by the user.
- Open source codebase is the transparency layer. Anyone can audit exactly what the tool does.
- This must be stated clearly and simply in the README, not buried in a privacy policy.

---

## What Looky Loo Does Not Do (v1 Scope)

- No Windows or Linux support (v1 Mac only)
- No interactive prototypes
- No animation or transition rendering
- No component-level detail (buttons, form inputs rendered as labeled blocks only)
- No deeply nested conditional layouts
- No persistence across sessions
- No cloud sync
- No team sharing features
- No self-updating (managed via Homebrew or npm)

---

## The Demo

The launch demo should be decided before a single line of code is written. The demo drives v1 scope.

Suggested demo scenario:

> User types into Claude Code: "Mock up an onboarding flow for a fitness app"

Panel appears. Four tabs populate one by one, each with a skeleton that crossfades to a wireframe. Welcome screen, Create Account, Set Preferences, All Done. Consistent visual language across all four. Timestamp on each. Export one as PNG, push the flow to Figma via MCP. Total time: under 30 seconds.

That is a compelling 15-second gif. That is the open source launch moment.

---

## Open Source Positioning

- GitHub repo: `lookyloo`
- License: MIT
- The schema spec is published separately as a contribution target -- community can write renderers, MCP adapters, and export formats without touching core
- No roadmap promises. Ship what works, accept contributions that improve it, let usage guide direction
- If Claude Code or another tool absorbs this capability natively, that's a win -- the contribution influenced the direction

---

## v1 Build Order

1. Schema design and validation (most important, do this first)
2. Output interceptor daemon (Node or Rust)
3. Tauri panel shell with local socket listener
4. Skeleton loading states
5. Single screen wireframe renderer
6. Tab system with labels and timestamps
7. Hide/show behavior and hotkey
8. Multi-screen flow support
9. Skeleton to render crossfade
10. PNG export
11. Copy as context export
12. MCP export (dynamic server detection)
13. Text rendering (secondary, do last)
14. Empty/idle state rotating phrases
15. README and demo gif

---

## Success Criteria for v1

- Installs in one command on Mac
- Works alongside Claude Code without any configuration
- Renders a single screen layout accurately and consistently with its export
- Renders a multi-screen flow with coherent design language across screens
- Panel shows, hides, and recalls correctly
- PNG export looks like a proper wireframe artifact
- MCP export reaches Figma (or any installed MCP destination) with accurate schema
- Zero data leaves the machine
- The 15-second demo gif is compelling enough to share

---

*Looky Loo -- Open Source -- MIT License*
*Built for developers who think visually and work in the terminal.*
