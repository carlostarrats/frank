// settings-panel.js — Settings modal. The Cloud section is tabbed: "Use
// Vercel" leads with a Deploy-to-Vercel button, then two collapsibles
// (condensed terminal + full walkthrough), then the URL/key fields. "Use
// your own" is the generic-endpoint form. Tabs are self-contained —
// switching doesn't carry state between them, so the user only ever
// sees the info that applies to the path they picked.

import sync from '../core/sync.js';
import { toastInfo, toastError } from './toast.js';
import { mountShareDiagnostics } from './share-envelope-panel.js';
import { showConfirm } from './confirm.js';

export function showSettingsPanel({ initialTopTab = 'cloud' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay settings-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Settings');

  overlay.innerHTML = `
    <div class="help-modal settings-modal">
      <div class="help-modal-header">
        <h2>Settings</h2>
        <button class="help-modal-close" id="settings-close" aria-label="Close">✕</button>
      </div>
      <div class="settings-body">
        <!-- Top-level tabs: Cloud Backend vs MCP Setup. Rendered as
             bordered buttons (not underlined) so they read as a higher layer
             of navigation than the Vercel / custom sub-tabs inside Cloud. -->
        <div class="settings-toptabs" role="tablist" aria-label="Settings sections">
          <button class="settings-toptab active" role="tab" data-toptab="cloud" aria-selected="true">Cloud Backend</button>
          <button class="settings-toptab" role="tab" data-toptab="mcp" aria-selected="false">MCP Setup</button>
          <button class="settings-toptab" role="tab" data-toptab="share-diag" aria-selected="false">Share Preview</button>
          <button class="settings-toptab" role="tab" data-toptab="v0" aria-selected="false">v0 API</button>
        </div>

        <div class="settings-toptab-panel" data-toptab="cloud" role="tabpanel">
        <section class="settings-section">
          <p class="settings-hint">
            Required only if you want to share projects with a link. Pick how
            you'd like to host it.
          </p>

          <div class="settings-tabs" role="tablist">
            <button class="settings-tab active" role="tab" data-tab="vercel" aria-selected="true">Use Vercel</button>
            <button class="settings-tab" role="tab" data-tab="custom" aria-selected="false">Use your own</button>
          </div>

          <!-- Vercel tab -->
          <div class="settings-tab-panel" data-tab="vercel" role="tabpanel">
            <p class="settings-configured-at" data-configured-at hidden></p>

            <p class="settings-hint">
              Deploy the reference backend (in <code>frank-cloud/</code>) to
              your own Vercel account. The backend needs three things to
              work: a Redis store (for live share), a Blob store (for share
              payloads), and an API key.
            </p>

            <details class="settings-cli" open>
              <summary>What you'll set up (~10 minutes)</summary>
              <ol class="settings-guide-steps">
                <li><strong>Upstash Redis</strong> — powers live-share presence, pub/sub, session tracking. Free tier is fine.</li>
                <li><strong>Vercel Blob</strong> — stores share payloads, snapshots, reviewer comments. Free tier.</li>
                <li><strong>FRANK_API_KEY</strong> — random string that authenticates this Frank daemon against your backend.</li>
              </ol>
              <p class="settings-field-hint">
                The <strong>Deploy</strong> button below handles the clone +
                build + <code>FRANK_API_KEY</code> prompt. Linking the two
                stores and disabling Deployment Protection are manual
                post-deploy steps — Vercel's UI doesn't automate those
                through the clone URL. The checklist below has exact
                click-paths. Full walkthrough with screenshots:
                <a href="https://github.com/carlostarrats/frank/blob/main/frank-cloud/DEPLOYMENT.md" target="_blank" rel="noopener">DEPLOYMENT.md</a>.
              </p>
            </details>

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
              Opens Vercel in a new tab. Sign in, set a value for
              <code>FRANK_API_KEY</code> when prompted, click Deploy. Come
              back here after the build finishes.
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
              <p class="settings-field-hint">
                Then finish the dashboard-only steps (see the "After deploy"
                checklist below). Redeploy (<code>vercel --prod</code>) so
                the env vars take effect. Paste URL + key below.
              </p>
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
                  <span class="settings-field-hint">Paste a long random string when prompted.</span>
                </li>
                <li>
                  <span>Link Upstash Redis + Blob to the project (dashboard):</span>
                  <span class="settings-field-hint">The CLI doesn't automate this part. In the Vercel dashboard, open your project → <strong>Storage</strong> → <strong>Connect Store</strong> → Upstash Redis (free tier, link to project). Repeat for Blob (public access, link to project).</span>
                </li>
                <li>
                  <span>Disable Vercel Authentication:</span>
                  <span class="settings-field-hint">Dashboard → Settings → Deployment Protection → set Vercel Authentication to <strong>Disabled</strong>. Share URLs are public by design.</span>
                </li>
                <li>
                  <span>Redeploy so the new env vars take effect:</span>
                  <div class="settings-cmd">
                    <code>vercel --prod</code>
                    <button class="settings-cmd-copy" data-copy="vercel --prod">Copy</button>
                  </div>
                  <span class="settings-field-hint">Then paste the URL and key below.</span>
                </li>
              </ol>
              <p class="settings-field-hint">
                Full walkthrough with screenshots + the exact gotchas we
                hit during v3.0 setup:
                <a href="https://github.com/carlostarrats/frank/blob/main/frank-cloud/DEPLOYMENT.md" target="_blank" rel="noopener">DEPLOYMENT.md</a>.
              </p>
            </details>

            <details class="settings-cli" open>
              <summary>After deploy — 3 manual steps in the Vercel dashboard</summary>
              <ol class="settings-guide-steps">
                <li>
                  <strong>Open your project → Storage tab → "Connect Store" → Upstash Redis.</strong>
                  <span class="settings-field-hint">Pick the free-tier plan, click Install, then link it to this project. Vercel auto-adds the env vars <code>KV_REST_API_URL</code> + <code>KV_REST_API_TOKEN</code>.</span>
                </li>
                <li>
                  <strong>Same tab → "Connect Store" → Blob.</strong>
                  <span class="settings-field-hint">Pick <strong>Public</strong> access (share links need to load without auth), link to this project. Auto-adds <code>BLOB_READ_WRITE_TOKEN</code>. Creating a store is not the same as linking — confirm in the store's Projects tab that this project shows up.</span>
                </li>
                <li>
                  <strong>Settings → Deployment Protection → set Vercel Authentication to Disabled.</strong>
                  <span class="settings-field-hint">Frank share URLs are public by design — anonymous reviewers open them without a Vercel account. The default protection gate blocks that. Full Disable (not "Only Production Deployments").</span>
                </li>
                <li>
                  <strong>Redeploy once</strong> so the new env vars take effect. (Deployments tab → latest deploy → ⋯ → Redeploy.)
                </li>
              </ol>
            </details>

            <details class="settings-cli">
              <summary>Why would I want a new deployment?</summary>
              <p class="settings-field-hint">
                Usually you don't. One backend handles every project you share,
                forever — each new share gets its own link with a unique ID, all
                served from this same backend.
              </p>
              <p class="settings-field-hint">Redeploy only if you want:</p>
              <ul class="settings-why-list">
                <li>A fresh backend with clean storage.</li>
                <li>To replace one you deleted or lost the key for.</li>
                <li>To move to a different Vercel account.</li>
              </ul>
            </details>

            <hr class="settings-divider">

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

          <!-- Custom tab -->
          <div class="settings-tab-panel" data-tab="custom" role="tabpanel" hidden>
            <p class="settings-configured-at" data-configured-at hidden></p>

            <p class="settings-hint">
              Point Frank at any host that implements the
              <a href="https://github.com/carlostarrats/frank/blob/main/CLOUD_API.md" target="_blank" rel="noopener">Cloud API contract</a>
              — Cloudflare Workers, Deno Deploy, a Node server, anything that
              serves the seven endpoints (static share CRUD, comments, live
              share state + stream + ping + health).
            </p>

            <details class="settings-cli" open>
              <summary>What your backend needs (regardless of platform)</summary>
              <ol class="settings-guide-steps">
                <li>
                  <strong>Redis-compatible store.</strong>
                  <span class="settings-field-hint">Powers live-share presence, pub/sub, session tracking, and the 60-second diff buffer. The reference impl uses Upstash Redis over their REST API; other stores work if you adapt <code>frank-cloud/lib/redis.ts</code>. Skip this and canvas live share won't work, but static share still will.</span>
                </li>
                <li>
                  <strong>Blob / object store with public read.</strong>
                  <span class="settings-field-hint">Stores share payloads, snapshots, comments. The reference impl uses Vercel Blob with public access. Any S3-compatible store works — what matters is that reviewer URLs can fetch share payloads without auth (the unguessable share ID is the access control).</span>
                </li>
                <li>
                  <strong>API key auth.</strong>
                  <span class="settings-field-hint">Frank's daemon sends a long-lived bearer token in the Authorization header on every authed request. Your backend checks it. The reference impl stores this in a <code>FRANK_API_KEY</code> env var.</span>
                </li>
                <li>
                  <strong>Long-lived SSE connections.</strong>
                  <span class="settings-field-hint">The <code>/api/share/:id/stream</code> and <code>/author-stream</code> endpoints hold open for minutes at a time. If your host caps request duration (AWS Lambda classic, Vercel Hobby at ~300s, Cloudflare Workers at 30s) you'll see disconnects; SSE reconnects handle this but viewers notice. Hosts with longer timeouts give a smoother experience.</span>
                </li>
                <li>
                  <strong>Public read access on share URLs.</strong>
                  <span class="settings-field-hint">Share links are opened by anonymous reviewers. If your host has an auth/access gate by default (like Vercel's "Deployment Protection"), disable it on the routes reviewers hit (<code>/s/*</code>, <code>/api/share*</code>, <code>/api/comment</code>).</span>
                </li>
                <li>
                  <strong>CORS for <code>/api/*</code>.</strong>
                  <span class="settings-field-hint">The daemon runs at <code>localhost:42068</code>, your backend runs elsewhere. The API routes need <code>Access-Control-Allow-Origin: *</code> (or your daemon's origin), plus OPTIONS preflight support. See <code>frank-cloud/vercel.json</code> for the header set.</span>
                </li>
              </ol>
              <p class="settings-field-hint">
                Full reference implementation + the exact contract:
                <a href="https://github.com/carlostarrats/frank/blob/main/frank-cloud/DEPLOYMENT.md" target="_blank" rel="noopener">DEPLOYMENT.md</a>
                and
                <a href="https://github.com/carlostarrats/frank/blob/main/CLOUD_API.md" target="_blank" rel="noopener">CLOUD_API.md</a>.
              </p>
            </details>

            <details class="settings-cli">
              <summary>Prefer the terminal?</summary>
              <p class="settings-field-hint">Skip this form and save both values from your shell:</p>
              <div class="settings-cmd">
                <code>frank connect &lt;url&gt; --key &lt;bearer-token&gt;</code>
                <button class="settings-cmd-copy" data-copy="frank connect <url> --key <bearer-token>">Copy</button>
              </div>
            </details>

            <hr class="settings-divider">

            <label class="settings-field">
              <span class="settings-label">Endpoint URL</span>
              <input type="url" data-field="url" class="input" placeholder="https://your-api.example.com" autocomplete="off" spellcheck="false">
            </label>
            <label class="settings-field">
              <span class="settings-label">Bearer token</span>
              <input type="password" data-field="key" class="input" placeholder="Token your backend expects in the Authorization header" autocomplete="off" spellcheck="false">
              <span class="settings-field-hint">Stored at <code>~/.frank/config.json</code> with 0600 permissions. Never leaves your machine except to your configured endpoint.</span>
            </label>
            <div class="settings-actions">
              <button class="btn-secondary" data-action="test">Test connection</button>
              <button class="btn-primary" data-action="save">Save</button>
            </div>
            <div class="settings-status" data-status aria-live="polite"></div>
          </div>
        </section>
        </div>

        <div class="settings-toptab-panel" data-toptab="mcp" role="tabpanel" hidden>
          <section class="settings-section">
            <p class="settings-hint">
              Connect Claude, Cursor, or any MCP-capable AI to Frank. The AI gets a read of your projects (comments, canvas state, snapshots, timeline) and — on canvas projects — can draft shapes, text, connectors, and comments directly, plus mint new share links.
            </p>

            <div class="settings-field">
              <span class="settings-label">1. Add Frank to your AI client's MCP config</span>
              <div class="settings-cmd settings-cmd-multiline">
                <code>{
  "mcpServers": {
    "frank": { "command": "frank", "args": ["mcp"] }
  }
}</code>
                <button class="settings-cmd-copy" data-copy='{
  "mcpServers": {
    "frank": { "command": "frank", "args": ["mcp"] }
  }
}'>Copy</button>
              </div>
              <span class="settings-field-hint">
                Paste into the MCP-servers block. Existing entries in the same config stay unaffected.
              </span>
            </div>

            <div class="settings-field">
              <span class="settings-label">2. Find the config file for your client</span>
              <ul class="settings-why-list">
                <li><strong>Claude Desktop</strong> — <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS). Restart the app after editing.</li>
                <li><strong>Claude Code</strong> — settings → MCP servers, or <code>.claude.json</code> in the project root.</li>
                <li><strong>Cursor</strong> — Settings → Features → Model Context Protocol.</li>
                <li><strong>Other MCP clients</strong> — check their docs for where MCP servers are declared. The JSON above is the standard shape.</li>
              </ul>
            </div>

            <div class="settings-field">
              <span class="settings-label">3. Keep Frank's daemon running</span>
              <div class="settings-cmd">
                <code>frank start</code>
                <button class="settings-cmd-copy" data-copy="frank start">Copy</button>
              </div>
              <span class="settings-field-hint">
                Tool calls bridge to the daemon on <code>localhost:42069</code>. If it's not running, calls return a clear error so the AI can tell you.
              </span>
            </div>

            <hr class="settings-divider">

            <details class="settings-cli" open>
              <summary>What the AI can do</summary>
              <ul class="settings-why-list">
                <li><strong>Read</strong> — <code>list_projects</code>, <code>load_project</code>, <code>get_intent</code>, <code>get_comments</code>, <code>get_canvas_state</code>, <code>list_snapshots</code>, <code>get_timeline</code>, <code>export_bundle</code>.</li>
                <li><strong>Write (canvas)</strong> — <code>add_shape</code> (13 kinds), <code>add_text</code>, <code>add_path</code>, <code>add_connector</code>, <code>add_comment</code>.</li>
                <li><strong>Share</strong> — <code>create_share</code> (canvas projects only at v1). URL share auto-deploy, PDF, and image shares are human-driven in the Frank UI — URL shares because the Vercel token is sensitive and per-share intent matters; PDF/image because their snapshot runs in the browser.</li>
              </ul>
            </details>

            <details class="settings-cli">
              <summary>What the AI can't do (by design)</summary>
              <ul class="settings-why-list">
                <li>Revoking a share link</li>
                <li>Starting, pausing, or resuming live share</li>
                <li>Deleting or purging projects</li>
                <li>Approving or dismissing comments (curation stays a human decision)</li>
              </ul>
              <p class="settings-field-hint">
                If the user asks the AI for any of the above, it will tell them to use the Frank UI. Keeps destructive / stream-control / judgment actions human-driven.
              </p>
            </details>

            <details class="settings-cli">
              <summary>Security notes</summary>
              <p class="settings-field-hint">
                The MCP server runs on stdio — no new network listener. It's spawned as a subprocess of the AI client and exits with it. Writes are additive only (shapes, text, comments) and land in the timeline, so every AI-authored change is recoverable. If your AI client is trusted to see your other files and chats, it's already trusted to see Frank's local data.
              </p>
            </details>
          </section>
        </div>

        <div class="settings-toptab-panel" data-toptab="share-diag" role="tabpanel" hidden>
          <section class="settings-section">
            <div id="share-diagnostics-host"></div>
          </section>
        </div>

        <div class="settings-toptab-panel" data-toptab="v0" role="tabpanel" hidden>
          <section class="settings-section">
            <p class="settings-hint">
              Lets the &ldquo;Send to v0&rdquo; button post curated feedback as a follow-up message into an existing v0 chat.
              Get your key at <a href="https://v0.dev/chat/settings/keys" target="_blank" rel="noopener">v0.dev/chat/settings/keys</a>.
            </p>
            <div class="settings-status" id="v0-status" aria-live="polite">Not configured — Send to v0 will fall back to opening v0.dev in a new tab.</div>
            <label class="settings-field">
              <span class="settings-label">v0 API key</span>
              <input type="password" id="v0-key" class="input" placeholder="Paste your v0 API key" autocomplete="off" spellcheck="false">
            </label>
            <div class="settings-actions">
              <button class="btn-primary" id="v0-save">Save</button>
              <button class="btn-ghost" id="v0-clear">Clear</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Mount the share diagnostics harness into its host. It's lazy from the
  // user's POV — no network traffic until they hit the Check button.
  const diagHost = overlay.querySelector('#share-diagnostics-host');
  if (diagHost) mountShareDiagnostics(diagHost);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onEscape);
  }
  function onEscape(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onEscape);
  overlay.querySelector('#settings-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ── Top-level tab switching (Cloud Backend vs MCP Setup) ─────────────────
  const topTabs = overlay.querySelectorAll('.settings-toptab');
  const topPanels = overlay.querySelectorAll('.settings-toptab-panel');
  function activateTopTab(id) {
    topTabs.forEach((t) => {
      const on = t.dataset.toptab === id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    topPanels.forEach((p) => {
      if (p.dataset.toptab === id) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });
  }
  topTabs.forEach((t) => t.addEventListener('click', () => activateTopTab(t.dataset.toptab)));
  if (initialTopTab && initialTopTab !== 'cloud') activateTopTab(initialTopTab);

  // ── Sub-tab switching inside Cloud Backend (Vercel vs custom) ───────────
  const tabs = overlay.querySelectorAll('.settings-tab');
  const panels = overlay.querySelectorAll('.settings-tab-panel');
  function activateTab(id) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panels.forEach((p) => {
      if (p.dataset.tab === id) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });
  }
  tabs.forEach((t) => t.addEventListener('click', () => activateTab(t.dataset.tab)));

  // ── Copy buttons (shared by Cloud sub-tabs + MCP Setup snippets) ────────
  overlay.querySelectorAll('.settings-cmd-copy[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = original; }, 1200);
      } catch { /* best-effort */ }
    });
  });

  // ── Per-panel form wiring ────────────────────────────────────────────────
  panels.forEach(wirePanel);

  // Populate the URL in both panels from config so the user doesn't re-type
  // when revisiting Settings. Key is never echoed back from the daemon.
  sync.getCloudConfig().then((config) => {
    if (!config?.cloudUrl) return;
    const urlInputs = overlay.querySelectorAll('input[data-field="url"]');
    urlInputs.forEach((el) => { el.value = config.cloudUrl; });
    if (config.hasApiKey) {
      overlay.querySelectorAll('input[data-field="key"]').forEach((el) => {
        el.placeholder = '•••••••• (key on file — retype to change)';
      });
      if (config.configuredAt) {
        const when = new Date(config.configuredAt);
        if (!Number.isNaN(when.getTime())) {
          const label = `Already configured on ${when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} at ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`;
          overlay.querySelectorAll('[data-configured-at]').forEach((el) => {
            el.textContent = label;
            el.removeAttribute('hidden');
          });
        }
      }
    }
  });

  // Focus the URL input of the default tab.
  setTimeout(() => {
    overlay.querySelector('.settings-tab-panel:not([hidden]) input[data-field="url"]')?.focus();
  }, 0);

  function wirePanel(panel) {
    const urlEl = panel.querySelector('input[data-field="url"]');
    const keyEl = panel.querySelector('input[data-field="key"]');
    const statusEl = panel.querySelector('[data-status]');
    const testBtn = panel.querySelector('[data-action="test"]');
    const saveBtn = panel.querySelector('[data-action="save"]');

    function setStatus(kind, message) {
      statusEl.className = `settings-status settings-status-${kind}`;
      statusEl.textContent = message;
    }

    async function doSave() {
      const url = (urlEl.value || '').trim();
      const key = (keyEl.value || '').trim();
      if (!url || !key) {
        setStatus('error', 'Both URL and key are required to save.');
        return false;
      }
      const result = await sync.setCloudConfig(url, key);
      if (result?.type === 'error') {
        setStatus('error', result.error || 'Could not save');
        toastError(`Settings: ${result.error || 'save failed'}`);
        return false;
      }
      return true;
    }

    async function doTest() {
      testBtn.disabled = true;
      saveBtn.disabled = true;
      setStatus('info', 'Testing connection…');
      try {
        const saved = await doSave();
        if (!saved) return;
        const result = await sync.testCloudConnection();
        if (result?.ok) {
          setStatus('ok', 'Connected — your backend is reachable and the key is valid.');
          toastInfo('Cloud backend connected');
        } else {
          setStatus('error', result?.error || 'Connection failed');
        }
      } finally {
        testBtn.disabled = false;
        saveBtn.disabled = false;
      }
    }

    testBtn.addEventListener('click', doTest);
    saveBtn.addEventListener('click', async () => {
      const saved = await doSave();
      if (saved) {
        setStatus('ok', 'Saved.');
        toastInfo('Cloud settings saved');
      }
    });
  }

  // ── v0 Platform API section ──────────────────────────────────────────────
  const v0KeyEl = overlay.querySelector('#v0-key');
  const v0StatusEl = overlay.querySelector('#v0-status');
  const v0SaveBtn = overlay.querySelector('#v0-save');
  const v0ClearBtn = overlay.querySelector('#v0-clear');

  function refreshV0Status() {
    sync.getV0Config().then((config) => {
      if (config?.hasKey && config?.configuredAt) {
        const when = new Date(config.configuredAt);
        const dateStr = Number.isNaN(when.getTime())
          ? config.configuredAt
          : when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        v0StatusEl.className = 'settings-status settings-status-ok';
        v0StatusEl.textContent = `Configured ${dateStr}`;
      } else if (config?.hasKey) {
        v0StatusEl.className = 'settings-status settings-status-ok';
        v0StatusEl.textContent = 'Configured';
      } else {
        v0StatusEl.className = 'settings-status';
        v0StatusEl.textContent = 'Not configured — Send to v0 will fall back to opening v0.dev in a new tab.';
      }
    }).catch(() => {
      v0StatusEl.className = 'settings-status';
      v0StatusEl.textContent = 'Not configured — Send to v0 will fall back to opening v0.dev in a new tab.';
    });
  }

  v0SaveBtn.addEventListener('click', async () => {
    const key = (v0KeyEl.value || '').trim();
    if (!key) { toastError('Paste a key first'); return; }
    v0SaveBtn.disabled = true;
    try {
      // Validate the key before storing it. /v1/user is free (no credit cost)
      // and prevents bad keys from being silently saved.
      const test = await sync.testV0Token(key);
      if (!test?.ok) {
        toastError('v0 rejected the key — not saving');
        return;
      }
      await sync.setV0Config(key);
      v0KeyEl.value = '';
      toastInfo('v0 key saved and validated');
      refreshV0Status();
    } catch {
      toastError('Could not save v0 key');
    } finally {
      v0SaveBtn.disabled = false;
    }
  });

  v0ClearBtn.addEventListener('click', () => {
    showConfirm({
      title: 'Clear v0 API key?',
      message: 'The saved key will be removed. Send to v0 will fall back to opening v0.dev in a new tab.',
      destructive: true,
      confirmLabel: 'Clear',
    }).then(async (confirmed) => {
      if (!confirmed) return;
      try {
        await sync.clearV0Config();
        toastInfo('v0 key cleared');
        refreshV0Status();
      } catch {
        toastError('Could not clear v0 key');
      }
    });
  });

  // Populate status on open.
  refreshV0Status();

  // Copy-to-clipboard for command snippets.
  overlay.querySelectorAll('.settings-cmd-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const text = btn.getAttribute('data-copy') || '';
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = original; }, 1400);
    });
  });
}
