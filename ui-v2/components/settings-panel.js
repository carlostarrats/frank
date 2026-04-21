// settings-panel.js — Settings modal. The Cloud section is tabbed: "Use
// Vercel" leads with a Deploy-to-Vercel button, then two collapsibles
// (condensed terminal + full walkthrough), then the URL/key fields. "Use
// your own" is the generic-endpoint form. Tabs are self-contained —
// switching doesn't carry state between them, so the user only ever
// sees the info that applies to the path they picked.

import sync from '../core/sync.js';
import { toastInfo, toastError } from './toast.js';

export function showSettingsPanel() {
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
        <section class="settings-section">
          <h3>Cloud backend</h3>
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
    </div>
  `;
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onEscape);
  }
  function onEscape(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onEscape);
  overlay.querySelector('#settings-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // ── Tab switching ────────────────────────────────────────────────────────
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
