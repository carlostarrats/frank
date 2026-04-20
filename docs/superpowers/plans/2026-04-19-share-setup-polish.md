# Frank v2 — Share Setup Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vercel-tab CLI wall in the Settings modal with a one-click "Deploy to Vercel" button and restructure the remaining CLI content into two collapsibles (condensed + full walkthrough). No changes to the daemon, the Cloud API contract, or `frank-cloud/`.

**Architecture:** Pure frontend UX change in `ui-v2/components/settings-panel.js`. Re-renders the Vercel tab's innerHTML in this order: (1) primary "Deploy to Vercel" anchor button with Vercel deploy-clone URL, (2) `<details>` "Prefer the terminal?" containing the condensed two-command path, (3) `<details>` "Full setup walkthrough" containing the existing verbatim three-step `<ol>`. Below the three tiers, the URL/key fields + Save/Test actions remain untouched. The "Use your own" tab is not modified. Styling additions go in `ui-v2/styles/app.css`.

**Tech Stack:** Plain JS ES module (no build step), plain DOM innerHTML, Vercel deploy-button URL (`https://vercel.com/new/clone`), CSS custom properties for theming. No framework, no bundler.

**Source spec:** `/Users/carlostarrats/Downloads/frank-v2-share-polish.md` (and the project-level `CLAUDE.md` for Frank architecture constraints).

---

## File Structure

- **Modify:** `ui-v2/components/settings-panel.js` — replace the Vercel tab panel innerHTML; surrounding tab switching, wiring, config population, copy-to-clipboard, and close handlers stay unchanged.
- **Modify:** `ui-v2/styles/app.css` — add one styled class (`.settings-deploy-btn`) for the primary CTA. Existing `.settings-cli` / `.settings-cmd` / `.settings-guide-steps` classes are reused as-is.
- **No other files change.**

No new modules. No daemon changes. No `frank-cloud/` changes.

---

## Deploy Button URL

The button links to Vercel's deploy-clone URL. The URL must clone the Frank repo, set the root directory to `frank-cloud/`, and prompt for `FRANK_API_KEY` during deploy so Vercel wires it automatically (which removes the "redeploy after env add" step from the current CLI flow).

Exact URL (used verbatim in Task 2):

```
https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcarlostarrats%2Ffrank&root-directory=frank-cloud&project-name=frank-cloud&env=FRANK_API_KEY&envDescription=Random%20string%20Frank%20sends%20in%20the%20Authorization%20header.%20Generate%20a%20long%20random%20value%20and%20keep%20it%20secret.&envLink=https%3A%2F%2Fgithub.com%2Fcarlostarrats%2Ffrank%2Fblob%2Fmain%2FCLOUD_API.md
```

Rationale:
- `repository-url=https://github.com/carlostarrats/frank` — this repo holds the reference backend.
- `root-directory=frank-cloud` — tells Vercel that the deployable app lives in that subfolder.
- `project-name=frank-cloud` — sensible default.
- `env=FRANK_API_KEY` — Vercel prompts the user to enter this at deploy time, then injects it into the production environment. No post-deploy CLI redeploy required.
- `envDescription` / `envLink` — inline help on the Vercel deploy screen.

---

## Task 1: Replace the Vercel tab panel innerHTML (three-tier structure)

**Files:**
- Modify: `ui-v2/components/settings-panel.js:36-92` (the `<!-- Vercel tab -->` block)

- [ ] **Step 1: Open `ui-v2/components/settings-panel.js` and replace the Vercel tab panel**

Locate the block starting at line 37 (`<div class="settings-tab-panel" data-tab="vercel" role="tabpanel">`) and ending at line 92 (its closing `</div>` before `<!-- Custom tab -->`). Replace that entire block with:

```html
          <!-- Vercel tab -->
          <div class="settings-tab-panel" data-tab="vercel" role="tabpanel">
            <p class="settings-hint">
              Deploy the reference backend (in <code>frank-cloud/</code>) to
              your own Vercel account. One click, then paste two values back
              here.
            </p>

            <a
              class="settings-deploy-btn"
              href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcarlostarrats%2Ffrank&root-directory=frank-cloud&project-name=frank-cloud&env=FRANK_API_KEY&envDescription=Random%20string%20Frank%20sends%20in%20the%20Authorization%20header.%20Generate%20a%20long%20random%20value%20and%20keep%20it%20secret.&envLink=https%3A%2F%2Fgithub.com%2Fcarlostarrats%2Ffrank%2Fblob%2Fmain%2FCLOUD_API.md"
              target="_blank"
              rel="noopener"
            >
              <svg width="16" height="16" viewBox="0 0 76 65" aria-hidden="true" focusable="false"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z" fill="currentColor"/></svg>
              <span>Deploy to Vercel</span>
            </a>
            <p class="settings-field-hint">
              Opens Vercel in a new tab. You'll sign into your own account,
              set a value for <code>FRANK_API_KEY</code> when prompted, and
              click Deploy. When it finishes, copy the deployment URL and
              the key value into the fields below.
            </p>

            <details class="settings-cli">
              <summary>Prefer the terminal?</summary>
              <p class="settings-field-hint">Already have the Vercel CLI set up? Run:</p>
              <div class="settings-cmd">
                <code>cd frank-cloud &amp;&amp; vercel --prod</code>
                <button class="settings-cmd-copy" data-copy="cd frank-cloud && vercel --prod">Copy</button>
              </div>
              <div class="settings-cmd">
                <code>vercel env add FRANK_API_KEY production</code>
                <button class="settings-cmd-copy" data-copy="vercel env add FRANK_API_KEY production">Copy</button>
              </div>
              <p class="settings-field-hint">Redeploy once (<code>vercel --prod</code>) so the env var takes effect, then paste the URL and key below.</p>
            </details>

            <details class="settings-cli">
              <summary>Full setup walkthrough</summary>
              <p class="settings-field-hint">Step-by-step for first-time Vercel users:</p>
              <ol class="settings-guide-steps">
                <li>
                  <span>Install the Vercel CLI and log in (one time):</span>
                  <div class="settings-cmd">
                    <code>npm i -g vercel &amp;&amp; vercel login</code>
                    <button class="settings-cmd-copy" data-copy="npm i -g vercel && vercel login">Copy</button>
                  </div>
                </li>
                <li>
                  <span>Deploy the reference backend from this repo:</span>
                  <div class="settings-cmd">
                    <code>cd frank-cloud &amp;&amp; vercel --prod</code>
                    <button class="settings-cmd-copy" data-copy="cd frank-cloud && vercel --prod">Copy</button>
                  </div>
                  <span class="settings-field-hint">Vercel prints a URL like <code>https://frank-cloud-xyz.vercel.app</code>.</span>
                </li>
                <li>
                  <span>Add your API key to the deployment:</span>
                  <div class="settings-cmd">
                    <code>vercel env add FRANK_API_KEY production</code>
                    <button class="settings-cmd-copy" data-copy="vercel env add FRANK_API_KEY production">Copy</button>
                  </div>
                  <span class="settings-field-hint">Paste a long random string when prompted. Redeploy once (<code>vercel --prod</code>) so the env var takes effect.</span>
                </li>
              </ol>
            </details>

            <label class="settings-field">
              <span class="settings-label">Vercel deployment URL</span>
              <input type="url" data-field="url" class="input" placeholder="https://frank-cloud-xyz.vercel.app" autocomplete="off" spellcheck="false">
            </label>
            <label class="settings-field">
              <span class="settings-label">API key (FRANK_API_KEY)</span>
              <input type="password" data-field="key" class="input" placeholder="The value you pasted for FRANK_API_KEY" autocomplete="off" spellcheck="false">
              <span class="settings-field-hint">Stored at <code>~/.frank/config.json</code> with 0600 permissions. Never leaves your machine except to your Vercel deployment.</span>
            </label>
            <div class="settings-actions">
              <button class="btn-secondary" data-action="test">Test connection</button>
              <button class="btn-primary" data-action="save">Save</button>
            </div>
            <div class="settings-status" data-status aria-live="polite"></div>
          </div>
```

Key points preserved:
- The shared fields (`data-field="url"`, `data-field="key"`, `data-action="test"`, `data-action="save"`, `data-status`) are byte-identical to the previous version, so `wirePanel` at line 179 keeps working unchanged.
- `.settings-cmd-copy` buttons still carry `data-copy` attributes, so the copy-to-clipboard handler at line 238 still works.
- The existing `frank connect` collapsible at the top of the Vercel tab is removed (it was a duplicate of the custom-tab version). The custom tab keeps its own.
- "Prefer the terminal?" now points at the condensed two-command path, matching the spec.
- "Full setup walkthrough" is the verbose version the spec calls for, preserving the existing three-step `<ol>` verbatim.

- [ ] **Step 2: Update the module header comment**

At the top of `ui-v2/components/settings-panel.js` lines 1-5, replace the existing comment with:

```js
// settings-panel.js — Settings modal. The Cloud section is tabbed: "Use
// Vercel" leads with a Deploy-to-Vercel button, then two collapsibles
// (condensed terminal + full walkthrough), then the URL/key fields. "Use
// your own" is the generic-endpoint form. Tabs are self-contained —
// switching doesn't carry state between them, so the user only ever
// sees the info that applies to the path they picked.
```

Reason: the comment is load-bearing documentation for future readers, and the structure it describes is now wrong.

- [ ] **Step 3: Commit**

```bash
git add ui-v2/components/settings-panel.js
git commit -m "feat(settings): add Deploy to Vercel button + three-tier Vercel tab"
```

---

## Task 2: Add deploy-button styling

**Files:**
- Modify: `ui-v2/styles/app.css` (append after the existing settings block, after line 99 `.settings-status-error`)

- [ ] **Step 1: Add the `.settings-deploy-btn` rule**

Open `ui-v2/styles/app.css`. After the `.settings-status-error` rule at line 99, and before the `/* Cloud-mode tabs */` comment at line 101, insert:

```css

/* Primary Deploy-to-Vercel CTA on the Vercel tab */
.settings-deploy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  align-self: flex-start;
  padding: 10px 18px;
  background: var(--text);
  color: var(--bg-app);
  border: 1px solid var(--text);
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  text-decoration: none;
  cursor: pointer;
  transition: opacity 0.12s, transform 0.04s;
}
.settings-deploy-btn:hover { opacity: 0.9; }
.settings-deploy-btn:active { transform: translateY(1px); }
.settings-deploy-btn:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.settings-deploy-btn svg { flex-shrink: 0; }
```

Rationale:
- Reuses existing CSS custom properties (`--text`, `--bg-app`, `--radius-md`, `--ring`) so it picks up Frank's dark theme tokens automatically.
- `align-self: flex-start` keeps the button hugging its own width inside the flex-column `.settings-tab-panel`, matching the Vercel-branded compact look rather than a full-width bar.
- `:focus-visible` gives it a keyboard focus ring, matching the project-wide convention called out in CLAUDE.md Coding Conventions.

- [ ] **Step 2: Commit**

```bash
git add ui-v2/styles/app.css
git commit -m "feat(settings): style the Deploy to Vercel CTA"
```

---

## Task 3: Manual verification in a running daemon

**Files:** none modified.

Spec says Frank is plain JS with no build step — refreshing the browser is the only required action. The daemon does not need to restart. Verification is manual because there is no automated UI test suite for the settings modal.

- [ ] **Step 1: Refresh the running UI**

Go to the browser tab at `http://localhost:42068` and hard-refresh (Cmd-Shift-R) to drop any cached module.

If the daemon is not running, start it: `frank start`. This is already a running session in most of the user's setups — no restart is needed for UI-only changes.

- [ ] **Step 2: Open Settings → verify the Vercel tab renders the new structure**

From the home header, click the cog icon to open the Settings modal. Cloud backend is the only section. The "Use Vercel" tab is active by default.

Check, top to bottom:
1. A short hint paragraph.
2. A **Deploy to Vercel** button (dark pill with the Vercel triangle icon).
3. A hint below it describing what to do when Vercel finishes.
4. A **Prefer the terminal?** collapsible. Expand it — it should contain two `<code>` blocks (`cd frank-cloud && vercel --prod` and `vercel env add FRANK_API_KEY production`) plus a redeploy reminder.
5. A **Full setup walkthrough** collapsible. Expand it — it should contain the original three-step `<ol>` verbatim (install CLI + login, deploy, add env var + redeploy).
6. The **Vercel deployment URL** input.
7. The **API key (FRANK_API_KEY)** password input with the storage-permissions hint.
8. **Test connection** and **Save** buttons.
9. An empty `aria-live` status row underneath.

Expected: both `<details>` render collapsed initially. The deploy button is left-aligned, not full-width.

- [ ] **Step 3: Verify the Deploy button opens the right Vercel URL**

Click **Deploy to Vercel**. A new browser tab should open at `vercel.com/new/clone?...`. On that page, verify:
- Repository source shows `carlostarrats/frank`.
- Root directory is `frank-cloud`.
- The project name prefill is `frank-cloud`.
- There is a required environment variable field labeled `FRANK_API_KEY` with the description text from the spec.

If Vercel's page complains about repository access (e.g., asks to install GitHub app), that's Vercel's normal onboarding flow for new users, not a Frank bug. Close the tab — no actual deploy is needed for this verification pass.

- [ ] **Step 4: Verify "Use your own" tab is unchanged**

Click the **Use your own** tab. Confirm it still shows:
- "Prefer the terminal?" collapsible with the `frank connect <url> --key <bearer-token>` command.
- Hint paragraph linking to `CLOUD_API.md`.
- Endpoint URL + Bearer token inputs.
- Test connection + Save buttons.

No visual or behavioral changes here.

- [ ] **Step 5: Verify the form wiring still works**

On the Vercel tab, type a fake URL (e.g., `https://example.invalid`) and a fake key, click **Test connection**. Expect a visible error in the status row — specifically the "Connection failed" path or a network error. This confirms `wirePanel` and the `data-field` / `data-action` hooks still bind correctly after the innerHTML rewrite.

Then clear the key field and click **Save** — expect the "Both URL and key are required to save." error from `doSave()`. This confirms validation still runs.

Finally, if a real cloud URL + key are already on file from a previous session, the URL input should be pre-populated (from `sync.getCloudConfig()` in `setupSettingsPanel.js:163`) and the key input's placeholder should read `•••••••• (key on file — retype to change)`. Confirm both still happen on modal reopen.

- [ ] **Step 6: Verify focus + keyboard behavior**

Reopen the Settings modal. Tab through the Vercel panel: focus order should be tab buttons → Deploy to Vercel → "Prefer the terminal?" summary → "Full setup walkthrough" summary → URL input → key input → Test connection → Save → modal close. Every focusable element should show the `--ring` outline from `:focus-visible`.

Press Escape. The modal should close (the existing `onEscape` handler on line 137).

- [ ] **Step 7: Commit any incidental fixes (only if something broke)**

If Steps 2–6 surfaced a real bug (e.g., a class name typo breaking styling), fix it and commit:

```bash
git add ui-v2/components/settings-panel.js ui-v2/styles/app.css
git commit -m "fix(settings): <describe the fix>"
```

If nothing is wrong, skip this step. Do not create an empty commit.

---

## Acceptance mapping

Cross-check against the spec's "Acceptance" section:

| Spec requirement | Covered by |
| --- | --- |
| User without Vercel CLI can click Deploy, sign in, deploy, paste URL + key, Save, Test — no terminal needed | Task 1 Step 1 (deploy button), Task 3 Steps 2–5 |
| User with Vercel CLI set up can use condensed two-command path without seeing full walkthrough | Task 1 Step 1 ("Prefer the terminal?" collapsed by default, condensed commands inside) |
| User new to Vercel can expand full walkthrough and see current three-step explanation | Task 1 Step 1 ("Full setup walkthrough" collapsible, verbatim `<ol>`) |
| "Use your own" tab unchanged in substance | Task 1 Step 1 leaves the custom tab block untouched; Task 3 Step 4 verifies |
| No changes to daemon, Cloud API contract, or `frank-cloud/` | Scope of Task 1 + Task 2; Task 3 does not modify any of those paths |

Spec non-goals (no hosted backend, no account-less share, no tunneling, no other deploy platforms) are honored by keeping scope to the two files above.

---

## Commit log (what the final branch should look like)

Three commits, in order:

1. `feat(settings): add Deploy to Vercel button + three-tier Vercel tab`
2. `feat(settings): style the Deploy to Vercel CTA`
3. (optional) `fix(settings): <description>` if Task 3 surfaced something real

No PRs, no pushes — the user will decide integration path separately.
