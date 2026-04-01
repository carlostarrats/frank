# Frank v2 — Comprehensive Test Plan

## 1. Daemon & CLI

| # | Test | How | Expected |
|---|------|-----|----------|
| 1.1 | Daemon starts | `frank start` | Prints "daemon started", opens browser to localhost:42068 |
| 1.2 | Daemon serves UI | Navigate to localhost:42068 | Home view renders (dark theme, URL input, title "Frank") |
| 1.3 | WebSocket connects | Check browser console | "[sync] connected" message |
| 1.4 | `frank status` | Run in terminal | Shows "cloud: not connected" |
| 1.5 | `frank stop` | Run in terminal | Removes CLAUDE.md injection, prints "stopped" |
| 1.6 | `frank connect` (no args) | Run in terminal | Shows usage instructions |
| 1.7 | `frank export` (no args) | Run in terminal | Shows usage instructions |

## 2. Home View & Project Management

| # | Test | How | Expected |
|---|------|-----|----------|
| 2.1 | Home renders | Load page | Shows "Frank" title, URL input, "Recent projects" section |
| 2.2 | Create project | Enter URL + name, click Open | Switches to viewer, project created in ~/.frank/projects/ |
| 2.3 | URL validation | Enter invalid URL (e.g., "not a url") | Error message shown |
| 2.4 | URL auto-fix | Enter "example.com" (no http) | Auto-prepends http://, creates project |
| 2.5 | Back to home | Click ← Back in viewer | Returns to home, project listed |
| 2.6 | Project list | Open home after creating projects | Shows projects with name, type, comment count, time ago |
| 2.7 | Open existing project | Click a project card | Loads viewer with that project's URL |
| 2.8 | Delete project | Click × on project card | Confirmation dialog, project removed from list and disk |

## 3. Viewer & iframe Wrapping

| # | Test | How | Expected |
|---|------|-----|----------|
| 3.1 | URL loads in iframe | Create project with localhost URL or example.com | Content visible in iframe |
| 3.2 | Toolbar shows info | Look at toolbar | Project name + URL displayed |
| 3.3 | Sidebar toggle | Click 💬 button | Sidebar slides open (360px), click again to close |
| 3.4 | Proxy fallback | Try a URL that blocks iframes | Falls back to proxy after 3s, content loads via proxy |
| 3.5 | Error state | Try unreachable URL | Error message: "Unable to load this URL" |
| 3.6 | Share button exists | Look at toolbar | Share button visible and clickable |
| 3.7 | Snapshot button exists | Look at toolbar | 📸 button visible |
| 3.8 | Timeline button exists | Look at toolbar | 📋 button visible |

## 4. Commenting & Overlay

| # | Test | How | Expected |
|---|------|-----|----------|
| 4.1 | Open sidebar | Click 💬 | Comment panel visible with "Comments (0)" or "Feedback (0)" |
| 4.2 | Enter comment mode | Click "+ Add" | Button changes to "✕ Cancel" |
| 4.3 | Element hover highlight | Hover over elements in iframe | Blue dashed outline follows meaningful elements |
| 4.4 | Smart detection | Click on a small <span> inside a button | Should highlight the button, not the span |
| 4.5 | Element select | Click an element | Solid blue outline, comment input appears |
| 4.6 | Submit comment | Type text, press Cmd+Enter or click Comment | Comment appears in list with author, time, CSS selector |
| 4.7 | Cancel comment | Press Escape or click Cancel | Input hides, no comment created |
| 4.8 | Delete comment | Click × on a comment | Comment removed |
| 4.9 | Comment persists | Go back to home, reopen project | Comment still there |
| 4.10 | Exit comment mode | Click "✕ Cancel" | Comment mode exits, cursor returns to normal |

## 5. Multi-page Tracking

| # | Test | How | Expected |
|---|------|-----|----------|
| 5.1 | Navigation detection | Click a link inside the iframe that navigates | Nav prompt slides down with route |
| 5.2 | Add screen | Click "Add Screen" on the prompt | Screen added to project |
| 5.3 | Dismiss prompt | Click "Dismiss" | Prompt disappears, no screen added |
| 5.4 | Auto-dismiss | Wait 10 seconds after prompt appears | Prompt auto-removes |

## 6. Curation Panel

| # | Test | How | Expected |
|---|------|-----|----------|
| 6.1 | Curation panel renders | Open sidebar with comments | Shows comments with status badges ("pending") |
| 6.2 | Filter tabs | Click "pending", "approved", etc. | Filters comments by status |
| 6.3 | Approve comment | Click ✓ on a comment | Status changes to "approved", green indicator |
| 6.4 | Dismiss comment | Click ✕ on a comment | Status changes to "dismissed", dimmed |
| 6.5 | Remix comment | Click ✎ on a comment | Remix textarea appears, type new text, save |
| 6.6 | Batch select | Check multiple comments | Batch action bar appears with count |
| 6.7 | Batch approve | Select 2+, click "Approve All" | All selected change to approved |
| 6.8 | Send to AI | Select comments, click "Send to AI" | AI routing modal opens |

## 7. AI Routing

| # | Test | How | Expected |
|---|------|-----|----------|
| 7.1 | Modal opens | Click "Send to AI" from curation | Modal shows reviewer comments + editable textarea |
| 7.2 | Edit instruction | Modify text in textarea | Text is editable |
| 7.3 | Copy for AI | Click "Copy for AI" | Structured markdown copied to clipboard, "Copied!" shown |
| 7.4 | Clipboard content | Paste clipboard after copy | Shows "## Feedback from reviewers" + "## My instruction" |
| 7.5 | Cancel | Click Cancel or overlay | Modal closes |

## 8. Snapshots

| # | Test | How | Expected |
|---|------|-----|----------|
| 8.1 | Manual snapshot | Click 📸 button | Snapshot saved to ~/.frank/projects/{id}/snapshots/ |
| 8.2 | Snapshot files | Check snapshot directory | Contains meta.json + snapshot.html |
| 8.3 | Snapshot in timeline | Open timeline after taking snapshot | Snapshot appears with "manual" trigger |

## 9. Timeline & Export

| # | Test | How | Expected |
|---|------|-----|----------|
| 9.1 | Timeline opens | Click 📋 button | Timeline view with chronological entries |
| 9.2 | Shows comments | Add comments first | Comments appear in timeline |
| 9.3 | Shows snapshots | Take snapshots first | Snapshots appear with dot indicators |
| 9.4 | Export JSON | Click "Export JSON" | Downloads .json file |
| 9.5 | Export content | Open downloaded JSON | Contains project, snapshots, comments, curations, aiInstructions, timeline |
| 9.6 | Back to viewer | Click ← Back | Returns to viewer |

## 10. Share Flow (requires cloud)

| # | Test | How | Expected |
|---|------|-----|----------|
| 10.1 | Share popover opens | Click Share button | Popover appears with cover note textarea |
| 10.2 | No cloud warning | Click Create Link without cloud connected | Error: "Not connected to cloud" |
| 10.3 | Sensitive detection | Share a page with emails/API keys visible | Warning shown before upload |

## 11. Data Persistence

| # | Test | How | Expected |
|---|------|-----|----------|
| 11.1 | Project persists | Stop and restart daemon | Projects still listed |
| 11.2 | Comments persist | Stop and restart daemon | Comments still on project |
| 11.3 | Curation persists | Stop and restart daemon | Approved/dismissed status retained |
| 11.4 | CLI export | `frank export <project-id>` | JSON written to ~/.frank/exports/ |
