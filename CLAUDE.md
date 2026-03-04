# Looky Loo — Claude Code Context

## What This Is
Terminal companion tool for Claude Code. Intercepts output via Claude Code hooks, classifies render-worthy content, generates a structured schema, and renders wireframes in a native Tauri panel.

Open source, MIT, Mac-first v1.

Full product proposal: `lookyloo-product-proposal.md`

---

## Architecture — Non-Negotiable Decisions

### Output Interception
- **Claude Code hooks system only** (PostToolUse, session events)
- Do NOT wrap the process, read from TTY/pty, or use any other interception method
- Hooks are the intended extension point — stable as Claude Code evolves

### Prompt Wrapper
- Inject a delimited block into `~/.claude/CLAUDE.md` on install
- Append if file exists, clean remove on uninstall
- User never touches it manually

### Tauri Layer
- **Thin shell only**: native window + local socket listener in Rust
- All logic lives in React — rendering, tabs, schema, exports
- Do not put application logic in Rust/Tauri. Treat it as infrastructure.

### Schema
- Schema is the single source of truth
- Panel render and ALL exports consume the identical schema
- Schema is versioned from day one (`"schema": "v1"`)
- Never render without a valid schema

---

## Tech Stack

| Layer | Technology |
|---|---|
| Companion panel | Tauri v2 (native macOS window) |
| Panel UI | React + TypeScript + Shadcn/Radix |
| Wireframe rendering | React components, React Flow for flows |
| Output interception | Claude Code hooks system |
| Panel/daemon communication | Local socket |
| Export: image | DOM-to-PNG |
| Export: MCP | Dynamic detection of user's installed MCP servers |
| Distribution | Homebrew (preferred) + npm |

---

## Project Structure

```
lookyloo/
├── src/                  # React frontend (all real logic lives here)
│   ├── components/       # UI components (tabs, wireframe renderers, skeletons)
│   ├── schema/           # Schema types and validation
│   ├── hooks/            # React hooks
│   └── exports/          # PNG, context copy, MCP export logic
├── src-tauri/            # Tauri/Rust shell (keep minimal)
│   ├── src/main.rs       # Entry point — window + socket listener only
│   └── tauri.conf.json
├── daemon/               # Claude Code hooks integration (Node)
└── CLAUDE.md
```

---

## Build Order (follow this)

1. Schema design and validation ← **current focus**
2. Output interceptor (hooks-based daemon)
3. Tauri panel shell + local socket listener
4. Skeleton loading states
5. Single screen wireframe renderer
6. Tab system (labels + timestamps)
7. Hide/show + hotkey
8. Multi-screen flow support
9. Skeleton → render crossfade
10. PNG export
11. Copy as context export
12. MCP export (dynamic server detection)
13. Text rendering (secondary)
14. Empty/idle state rotating phrases
15. README + demo gif

---

## Key Rules

- **Schema first**: never build a renderer before the schema it consumes is defined
- **Conservative classification**: render 5 things perfectly > attempt 20 and miss some
- **No persistence**: session-scoped only, nothing written to disk between sessions
- **No data leaves the machine**: no network calls except user-initiated MCP exports
- **Static renders only**: no interaction, no hover states, no animation in wireframes
- **No dock icon, no menu bar**: panel is invisible until there is something to render

---

## Coding Conventions

- TypeScript strict mode
- React functional components only, no class components
- Shadcn/Radix for all UI primitives
- Keep Rust surface area minimal — if logic can live in React, it lives in React
- No external state management library in v1 (React state + context is sufficient)
