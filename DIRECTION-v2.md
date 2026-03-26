# Frank v2 — Product Direction

Last updated: 2026-03-25

---

## What Frank becomes

A collaboration layer for any web content that connects humans and AI. Point it at any URL — localhost, staging, production — and Frank wraps it with commenting, sharing, feedback routing to AI, and a complete data trail of how the thing was built.

Frank is not a wireframe tool. Frank is not a design tool. Frank is the layer between building and shipping where feedback happens, decisions are made, and AI iterates based on real human input.

---

## Problem statement

When you build UI with AI, the feedback loop is broken:

- You build something → show it to someone → they give feedback in Slack or a call → you translate that into instructions for the AI → the AI changes the code → repeat
- Every step loses context. The reviewer's intent gets compressed into a Slack message. Your translation to the AI loses nuance. The connection between "what the reviewer said" and "what changed in the code" is invisible.
- Nobody captures the decision chain. Design decisions are scattered across conversations, lost in terminal history, and forgotten between sessions.

**The gap:** There's no tool that wraps real running code with a collaboration layer, routes feedback to AI agents, and captures the complete decision-making process as structured data.

- **Figma** is for design files, not running code
- **Agentation** does element-level feedback but is single-player, no sharing
- **Inflight** does design critique but is locked to Figma
- **Vercel Comments** works on deployments but doesn't route to AI or capture decision chains
- **GitHub PRs** capture code changes but not the visual feedback that triggered them

---

## The core loop

```
Build something (any code, any framework, any fidelity)
       ↓
Point Frank at it (any URL — localhost:3000, Vercel preview, production)
       ↓
You comment on specific elements (click any DOM element → anchored comment)
       ↓
Share with reviewers (link → they see the same page + commenting overlay)
       ↓
Reviewers leave feedback on specific elements (guided prompts optional)
       ↓
You curate the feedback (approve, dismiss, remix, rewrite)
       ↓
Route approved feedback to AI (Claude, Cursor, any agent)
       ↓
AI iterates → code changes → new snapshot captured
       ↓
Repeat
```

---

## Three data streams

Everything Frank captures falls into three connected streams:

### 1. Code evolution

Every meaningful state of the page gets snapshotted automatically:
- DOM snapshot + screenshot at each save point
- What changed since the last snapshot (element additions, removals, style changes)
- Linked to the feedback or action that triggered the change
- A visual timeline of how the thing was built — not just the current state

This is not git history. Git captures code diffs. Frank captures the visual state and connects it to the human decisions that caused the changes.

### 2. Human feedback

All comments from all participants, structured and anchored:
- **Your comments** — notes to yourself, instructions for the AI, design decisions
- **Reviewer comments** — feedback from teammates, clients, stakeholders via shared links
- Every comment anchored to a specific DOM element (via CSS selector or DOM path)
- Section-level or element-level granularity
- Guided feedback prompts available ("How does this feel?", "What's missing?", "What would you change?")
- Status: pending → approved / dismissed / remixed by you (the gatekeeper)

### 3. AI interaction chain

The connection between human feedback and AI action:
- Which reviewer comment triggered which instruction to the AI
- What you told the AI (your instruction, which may differ from the reviewer's words)
- What the AI changed in response
- Whether the AI's change addressed the feedback (your approval/dismissal of the result)
- The full chain: reviewer comment → your curation → your instruction → AI action → code diff → visual diff

**All three streams are linked.** A reviewer says "make the CTA bigger." You approve it, rewrite it as "increase the hero CTA size and add more visual weight — use the primary color." The AI changes the code. The snapshot captures before/after. The data connects the entire chain.

---

## Your role as gatekeeper

You are not blindly forwarding feedback to the AI. You are the curator:

- **Approve** — this feedback is valid, forward to AI as-is or with your refinement
- **Dismiss** — this feedback is noise, out of scope, or wrong. Record why.
- **Remix** — the feedback has a valid point but the reviewer didn't articulate it well. Rewrite it in your own words with better context for the AI.
- **Batch** — combine multiple pieces of feedback into a single coherent instruction for the AI

This curation is itself valuable data. It captures your design judgment — what you accepted, what you rejected, how you translated non-technical feedback into technical direction.

---

## How it works technically

### Wrapping any URL

Frank wraps any URL in an iframe with a commenting overlay:

1. You provide a URL (localhost:3000, a Vercel preview, any web page)
2. Frank loads it in a controlled iframe
3. An overlay layer sits on top — handles click-to-comment, element highlighting, selection
4. The iframe content is the real running page — Frank doesn't modify or re-render it

**Element targeting:** When you click an element to comment, Frank captures:
- CSS selector path (`.hero > .cta-button`)
- DOM path (as fallback)
- Visual position (screenshot coordinates)
- Element text content and computed styles

This is how the comment stays anchored even if the page layout shifts slightly.

### Sharing

Same URL-wrapping approach but served to others:

1. You hit "Share" → Frank takes a snapshot of the current page state
2. Generates a shareable link
3. Reviewer opens the link → sees the page with the commenting overlay
4. For localhost URLs: Frank can proxy the content or capture a snapshot (since reviewers can't access your localhost)
5. For deployed URLs: Frank wraps the live URL directly

**The localhost problem:** If you're sharing localhost:3000, the reviewer can't access it. Two options:
- **Snapshot mode:** Frank captures the full DOM + assets as a static snapshot, serves it via the share link. The reviewer sees a frozen version.
- **Tunnel mode (v2+):** Frank tunnels localhost to a public URL (like ngrok but built-in). The reviewer sees the live page.

Snapshot mode for v1. It's simpler and covers most feedback use cases (visual feedback on layout, copy, design).

### Feedback routing to AI

When you approve feedback and want to send it to the AI:

1. You select approved comments (one or multiple)
2. Click "Send to AI" or "Copy for AI"
3. Frank formats the feedback as a structured prompt:
   - Element reference (what they're commenting on)
   - The original reviewer comment
   - Your curation/remix (if you changed it)
   - Screenshot of the element
4. This gets injected into the AI's context (via CLAUDE.md, clipboard, or direct integration)

The AI now has: visual context + structured feedback + your curation. Much better than "can you make the button bigger" in a terminal.

### Data storage

All data stored locally as JSON files:

```
~/.frank/
├── projects/
│   ├── my-app/
│   │   ├── project.json        # Project metadata, URL, settings
│   │   ├── snapshots/          # DOM snapshots + screenshots per save point
│   │   │   ├── 001.json        # { dom, screenshot, timestamp, trigger }
│   │   │   └── 002.json
│   │   ├── comments/           # All comments
│   │   │   └── comments.json   # [{ id, element, author, text, status, ... }]
│   │   ├── ai-chain/           # AI interaction log
│   │   │   └── chain.json      # [{ feedbackIds, instruction, aiResponse, codeChanges }]
│   │   └── timeline.json       # Unified event timeline
│   └── other-project/
├── shares/                     # Shared snapshots
│   ├── abc123.json
│   └── def456.json
└── exports/                    # Exported datasets
```

**Exportable:** The entire project data can be exported as a structured JSON dataset. Every comment, every decision, every snapshot, every AI interaction. Importable by other tools, usable for training, analyzable for process insights.

---

## What stays from v1

- **Browser-based architecture** — Node.js daemon + browser UI at localhost:42068
- **Sharing with commenting** — the core mechanic stays, applied to real content instead of wireframes
- **Guided feedback prompts** — "How does this feel?", "What's missing?", "What would you change?"
- **Cover notes** — context when sharing
- **Note sync via daemon** — background sync, works when browser is closed
- **Project management** — multiple projects, home view, persistence

## What changes from v1

| Aspect | v1 | v2 |
|--------|----|----|
| Core product | Wireframe renderer | Collaboration layer for any web content |
| What it wraps | JSON schema → rendered wireframe | Any URL → iframe with overlay |
| Element targeting | Section index (0, 1, 2...) | CSS selector + DOM path + visual position |
| Feedback routing | Manual (copy/paste to AI) | Structured routing with context + screenshots |
| Data capture | Comments only | Comments + code evolution + AI interaction chain |
| Fidelity | Limited to Frank's renderer | Any fidelity (wireframes to production) |
| Framework lock-in | shadcn-style only | Works with anything |

## What gets removed

- The wireframe renderer (sections.js, screen.js, smart-item.js) — no longer core. Could be kept as an optional quick-sketch mode, but it's not the product.
- The JSON schema format — no longer the input format. The input is a URL.
- The canvas/zoom system — replaced by the iframe wrapper.

---

## Who this is for

**Primary:** Developers and makers building UI with AI assistants. They want to:
1. Point at what they're building
2. Get feedback from others on specific elements
3. Route that feedback to the AI with context
4. Track how the thing evolved over time

**Secondary:** Anyone reviewing web UI who needs to give structured, anchored feedback instead of screenshots and Slack messages.

**The data angle:** Teams that want to understand their design decision process — what feedback patterns emerge, how long iterations take, what gets approved vs rejected, how effectively AI implements feedback.

---

## Competitive position

| Tool | What it does | What it doesn't do |
|------|-------------|-------------------|
| **Agentation** | Click elements, annotate, feed to agent | No sharing, single-player only |
| **Inflight** | Structured design critique | Locked to Figma, no AI, no code |
| **Vercel Comments** | Comment on deployments | No AI routing, no decision chain capture |
| **GitHub PRs** | Code review | No visual feedback, no element targeting |
| **Figma** | Full design tool | For design files, not running code |
| **Frank** | Wrap any URL, comment, share, route to AI, capture everything | — |

Frank's niche: **the collaboration and feedback layer for AI-assisted UI development.** The tool that sits between "I built something" and "it shipped" where all the human and AI decisions happen.

---

## Licensing

**PolyForm Shield 1.0.0** — free to use, source available, can't build a competing product. Same as v1.

---

## Open questions

- **Localhost proxying:** For v1, snapshot mode. Should tunnel mode (live proxying) be v2 or is it needed sooner?
- **Cross-browser rendering:** Snapshots capture DOM state. Does the snapshot need to look identical across browsers?
- **AI integration depth:** v1 is "copy structured prompt." Should there be a direct Claude Code integration where Frank injects feedback into the active session?
- **Element targeting resilience:** CSS selectors break when code changes. How to keep comments anchored after significant refactors?
- **Team features:** Multiple users on the same project (not just share links). When?
- **Pricing model:** Free for individual use. What's the team/commercial model?
