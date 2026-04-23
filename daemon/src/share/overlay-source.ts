// frank-overlay.js source, embedded as a TS string so it ships through the
// daemon's compilation pipeline without needing a separate asset-copy step.
// Written to <deployment>/public/frank-overlay.js at bundle time.
//
// Step 5 scope: minimal viable — connects to the user's frank-cloud via SSE,
// renders a small Frank indicator in the corner, surfaces a "comments
// unavailable" state when the cloud isn't reachable. Full pin rendering and
// comment UX builds in later steps.

export const OVERLAY_SCRIPT_CONTENT = `/* frank-overlay.js — shipped by Frank at share time. Same-origin from the
   deployed app's public/. Reads data-share-id + data-cloud-url from its own
   script tag; connects to frank-cloud for comment state via SSE. */
(function () {
  'use strict';

  var scriptTag = document.currentScript;
  if (!scriptTag) {
    // Safari / very old browsers: find ourselves by src fallback.
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (/\\/frank-overlay\\.js(\\?|$)/.test(scripts[i].src)) {
        scriptTag = scripts[i];
        break;
      }
    }
  }
  if (!scriptTag) return;

  var shareId = scriptTag.getAttribute('data-share-id') || '';
  var cloudUrl = (scriptTag.getAttribute('data-cloud-url') || '').replace(/\\/+$/, '');
  if (!shareId || !cloudUrl) return;

  // Shadow host — isolates overlay CSS from the user's app and vice versa.
  var host = document.createElement('div');
  host.id = 'frank-overlay-host';
  host.setAttribute('aria-hidden', 'false');
  host.style.position = 'fixed';
  host.style.right = '16px';
  host.style.bottom = '16px';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  var attachHost = function () {
    if (document.body) document.body.appendChild(host);
    else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(host); });
  };
  attachHost();

  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = [
    '<style>',
    ':host { all: initial; }',
    '.pill {',
    '  pointer-events: auto;',
    '  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  color: #fff;',
    '  background: rgba(24, 24, 27, 0.85);',
    '  border: 1px solid rgba(255, 255, 255, 0.15);',
    '  border-radius: 999px;',
    '  padding: 8px 12px;',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 8px;',
    '  backdrop-filter: blur(6px);',
    '  -webkit-backdrop-filter: blur(6px);',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.25);',
    '}',
    '.dot {',
    '  width: 8px; height: 8px; border-radius: 50%;',
    '  background: #9ca3af;',
    '  transition: background 200ms ease;',
    '}',
    '.dot.connected { background: #22c55e; }',
    '.dot.disconnected { background: #ef4444; }',
    '.label { white-space: nowrap; }',
    '</style>',
    '<div class="pill" part="pill">',
    '  <span class="dot" id="dot"></span>',
    '  <span class="label" id="label">Frank share — connecting…</span>',
    '</div>',
  ].join('');

  var dot = shadow.getElementById('dot');
  var label = shadow.getElementById('label');

  function setState(state, text) {
    if (!dot) return;
    dot.className = 'dot' + (state ? ' ' + state : '');
    if (label) label.textContent = text;
  }

  // Cross-origin SSE to frank-cloud. The canvas live-share already serves a
  // stream endpoint at /api/share/:id/stream — the URL share reuses it.
  var es = null;
  var retry = 0;
  var MAX_RETRY_MS = 30000;
  function connect() {
    try {
      var url = cloudUrl + '/api/share/' + encodeURIComponent(shareId) + '/stream';
      es = new EventSource(url, { withCredentials: false });
      es.addEventListener('open', function () {
        retry = 0;
        setState('connected', 'Frank share · comments live');
      });
      es.addEventListener('error', function () {
        setState('disconnected', 'Comments unavailable — frank-cloud may be offline');
        // Exponential backoff, capped. Browser will also auto-reconnect on
        // its own, but we replace the source to give fresh credentials if
        // needed later.
        if (es) { es.close(); es = null; }
        var delay = Math.min(MAX_RETRY_MS, 1000 * Math.pow(2, retry++));
        setTimeout(connect, delay);
      });
    } catch (e) {
      setState('disconnected', 'Comments unavailable — frank-cloud may be offline');
    }
  }
  connect();
})();
`;
