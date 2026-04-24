// frank-overlay.js source, embedded as a TS string so it ships through the
// daemon's compilation pipeline without needing a separate asset-copy step.
// Written to <deployment>/public/frank-overlay.js at bundle time.

//
// Scope: click-to-place commenting for URL-share previews. The pill toggles
// comment mode; clicks in comment mode drop pins anchored by CSS selector +
// DOM path + viewport-% coords (same triple-anchor the in-Frank viewer uses,
// so comments flow back into the project via `mergeCloudComments`). Existing
// comments are fetched once via GET /api/share?id= and kept in sync through
// the SSE `comment` event on /api/share/:id/stream. Everything lives inside
// a shadow DOM so the user's app CSS can't leak in or out.

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

  var AUTHOR_KEY = 'frank-share-author';
  var MAX_RETRY_MS = 30000;
  var PIN_PALETTE = [
    '#ef4444', '#f59e0b', '#eab308', '#22c55e', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#d946ef', '#f97316', '#ec4899'
  ];

  // Click-anywhere commenting: every click becomes a free pin anchored by
  // viewport percentage. No element detection, no hover highlight, no
  // "pick a semantic target" — matches canvas + viewer commenting so the
  // reviewer UX feels identical on every surface.
  function buildAnchor(clientX, clientY) {
    return {
      type: 'pin',
      x: (clientX / window.innerWidth) * 100,
      y: (clientY / window.innerHeight) * 100
    };
  }

  // ── Shadow host covering the viewport. Pointer-events:none keeps the page
  // beneath it interactive; individual children opt back in. Entering comment
  // mode reveals .intercept which does capture clicks.
  var host = document.createElement('div');
  host.id = 'frank-overlay-host';
  host.setAttribute('aria-hidden', 'false');
  host.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:2147483647;';

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
    '  position: fixed; right: 16px; bottom: 16px;',
    '  pointer-events: auto;',
    '  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  color: #fff;',
    '  background: rgba(24, 24, 27, 0.88);',
    '  border: 1px solid rgba(255, 255, 255, 0.15);',
    '  border-radius: 999px;',
    '  padding: 8px 12px;',
    '  display: inline-flex; align-items: center; gap: 8px;',
    '  backdrop-filter: blur(6px);',
    '  -webkit-backdrop-filter: blur(6px);',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.25);',
    '  cursor: pointer;',
    '  user-select: none;',
    '  transition: background 120ms ease;',
    '}',
    '.pill:hover { background: rgba(24, 24, 27, 0.95); }',
    '.pill.mode { background: #dc2626; border-color: rgba(255,255,255,0.25); }',
    '.pill.mode:hover { background: #ef4444; }',
    '.dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; transition: background 200ms ease; flex-shrink: 0; }',
    '.dot.connected { background: #22c55e; }',
    '.dot.disconnected { background: #ef4444; }',
    '.label { white-space: nowrap; }',
    '.intercept {',
    '  position: fixed; inset: 0;',
    '  pointer-events: auto; cursor: crosshair;',
    '  background: rgba(0, 0, 0, 0.02);',
    '}',
    '.intercept[hidden] { display: none; }',
    '.pin {',
    '  position: fixed; transform: translate(-50%, -50%);',
    '  width: 24px; height: 24px; border-radius: 50%;',
    '  pointer-events: auto; cursor: pointer;',
    '  border: 2px solid #fff;',
    '  color: #fff;',
    '  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  box-shadow: 0 2px 6px rgba(0,0,0,0.35);',
    '  padding: 0;',
    '}',
    '.pin:hover { transform: translate(-50%, -50%) scale(1.1); }',
    /* .comment-input mirrors the in-Frank canvas-comment-input class — same
       width, padding, radius, drag strip at the top, textarea, right-aligned
       Cancel / Post. The reviewer overlay lives in a shadow root so it can't
       reuse Frank's stylesheet directly, but the rules below are the visual
       twin, so the composer looks identical on every surface. */
    '.comment-input {',
    '  position: fixed;',
    '  width: 260px;',
    '  pointer-events: auto;',
    '  background: #0a0a0a;',
    '  color: #f4f4f5;',
    '  border: 1px solid rgba(255,255,255,0.15);',
    '  border-radius: 10px;',
    '  box-shadow: 0 10px 30px rgba(0,0,0,0.45);',
    '  font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  padding: 8px;',
    '  display: flex; flex-direction: column; gap: 8px;',
    '}',
    '.comment-input.dragging { transition: none; }',
    '.comment-drag {',
    '  display: flex; align-items: center; justify-content: center;',
    '  height: 14px;',
    '  margin: -4px -4px 0;',
    '  border-radius: 6px;',
    '  cursor: move; user-select: none;',
    '  color: rgba(255,255,255,0.45);',
    '}',
    '.comment-drag:hover { background: rgba(255,255,255,0.06); }',
    '.comment-grip { font-size: 11px; letter-spacing: 2px; line-height: 1; pointer-events: none; }',
    '.comment-textarea {',
    '  width: 100%; box-sizing: border-box; min-height: 60px;',
    '  background: #18181b; color: #f4f4f5;',
    '  border: 1px solid rgba(255,255,255,0.18);',
    '  border-radius: 6px; padding: 6px 8px;',
    '  font: inherit; resize: vertical; outline: none;',
    '}',
    '.comment-textarea:focus { border-color: #60a5fa; }',
    '.comment-error { color: #fca5a5; font-size: 12px; }',
    '.comment-error[hidden] { display: none; }',
    '.comment-actions { display: flex; justify-content: flex-end; gap: 4px; }',
    '.comment-btn {',
    '  font: inherit; font-weight: 500;',
    '  border-radius: 6px; padding: 4px 10px; cursor: pointer;',
    '  border: 1px solid transparent;',
    '}',
    '.comment-btn.ghost { background: transparent; color: #d4d4d8; border-color: rgba(255,255,255,0.18); }',
    '.comment-btn.ghost:hover { background: rgba(255,255,255,0.06); }',
    '.comment-btn.primary { background: #f4f4f5; color: #09090b; }',
    '.comment-btn.primary:hover { background: #fff; }',
    '.comment-btn:disabled { opacity: 0.5; cursor: default; }',
    /* Read popover (click a pin) — same shell, different content. Shows
       author + timestamp + text, plus a Close button. Drag strip identical. */
    '.read-popover {',
    '  position: fixed; width: 280px; pointer-events: auto;',
    '  background: #0a0a0a; color: #f4f4f5;',
    '  border: 1px solid rgba(255,255,255,0.15);',
    '  border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,0.45);',
    '  font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
    '  padding: 8px;',
    '  display: flex; flex-direction: column; gap: 8px;',
    '}',
    '.read-popover.dragging { transition: none; }',
    '.read-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 12px; }',
    '.read-meta .author { font-weight: 600; }',
    '.read-meta .ts { color: rgba(255,255,255,0.55); font-size: 11px; }',
    '.read-body { white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }',
    '</style>',
    '<div class="intercept" hidden></div>',
    '<div class="pin-layer"></div>',
    '<div class="pill" part="pill">',
    '  <span class="dot" id="dot"></span>',
    '  <span class="label" id="label">Frank · connecting…</span>',
    '</div>'
  ].join('');

  var pill = shadow.querySelector('.pill');
  var dot = shadow.querySelector('#dot');
  var label = shadow.querySelector('#label');
  var pinLayer = shadow.querySelector('.pin-layer');
  var intercept = shadow.querySelector('.intercept');

  // ── State
  var mode = 'idle';          // 'idle' | 'comment'
  var dotState = '';          // '' | 'connected' | 'disconnected'
  var comments = [];          // in arrival order
  var pinByCommentId = {};    // id → pin button element
  var pinNumberById = {};     // id → 1-based index
  var popover = null;

  function setIdleLabel() {
    if (dotState === 'disconnected') label.textContent = 'Frank · comments offline';
    else if (dotState === 'connected') label.textContent = 'Frank · Click to comment';
    else label.textContent = 'Frank · connecting…';
  }

  function setMode(next) {
    mode = next;
    if (next === 'comment') {
      intercept.hidden = false;
      pill.classList.add('mode');
      label.textContent = 'Click anywhere to comment · Esc to cancel';
    } else {
      intercept.hidden = true;
      pill.classList.remove('mode');
      setIdleLabel();
    }
  }

  function setDotState(state) {
    dotState = state;
    dot.className = 'dot' + (state ? ' ' + state : '');
    if (mode === 'idle') setIdleLabel();
  }

  pill.addEventListener('click', function (e) {
    e.stopPropagation();
    if (mode === 'comment') setMode('idle');
    else setMode('comment');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (popover) { closePopover(); return; }
      if (mode === 'comment') setMode('idle');
    }
  });

  intercept.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    var anchor = buildAnchor(e.clientX, e.clientY);
    setMode('idle');
    openComposer(e.clientX, e.clientY, anchor);
  });

  // ── Popover plumbing
  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function positionPopover(pop, x, y) {
    var w = 280, h = 220, pad = 12;
    var left = Math.min(Math.max(pad, x + 12), window.innerWidth - w - pad);
    var top = Math.min(Math.max(pad, y + 12), window.innerHeight - h - pad);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  // Drag a popover by its grip strip. Clamps so the popover can't be
  // dragged fully off-screen (40px stays visible on each side, grip stays
  // within the top edge).
  function makeDraggable(pop, handle) {
    if (!handle) return;
    var startX = 0, startY = 0, origLeft = 0, origTop = 0, dragging = false;
    handle.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('button, a, input, textarea')) return;
      dragging = true;
      pop.classList.add('dragging');
      startX = e.clientX; startY = e.clientY;
      var rect = pop.getBoundingClientRect();
      origLeft = rect.left; origTop = rect.top;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      var rect = pop.getBoundingClientRect();
      var w = rect.width;
      var minLeft = -(w - 40);
      var maxLeft = window.innerWidth - 40;
      var minTop = 0;
      var maxTop = window.innerHeight - 32;
      var nl = Math.min(maxLeft, Math.max(minLeft, origLeft + dx));
      var nt = Math.min(maxTop, Math.max(minTop, origTop + dy));
      pop.style.left = nl + 'px';
      pop.style.top = nt + 'px';
    });
    function stop(e) {
      if (!dragging) return;
      dragging = false;
      pop.classList.remove('dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function openComposer(clientX, clientY, anchor) {
    closePopover();
    // Author defaults to whatever was last used (or "Reviewer") — no visible
    // name field, matching the in-Frank composer which has no name prompt.
    var author = safeStorage('get', AUTHOR_KEY) || 'Reviewer';
    var pop = document.createElement('div');
    pop.className = 'comment-input';
    pop.innerHTML = [
      '<div class="comment-drag" data-drag-handle aria-label="Drag to move"><span class="comment-grip" aria-hidden="true">⋮⋮</span></div>',
      '<textarea class="comment-textarea" rows="2" placeholder="Add a comment…" maxlength="2000" aria-label="New comment"></textarea>',
      '<div class="comment-error" hidden></div>',
      '<div class="comment-actions">',
      '  <button type="button" class="comment-btn ghost" data-action="cancel">Cancel</button>',
      '  <button type="button" class="comment-btn primary" data-action="submit">Post</button>',
      '</div>'
    ].join('');
    positionPopover(pop, clientX, clientY);
    shadow.appendChild(pop);
    popover = pop;
    makeDraggable(pop, pop.querySelector('[data-drag-handle]'));

    var textInput = pop.querySelector('.comment-textarea');
    var submitBtn = pop.querySelector('[data-action="submit"]');
    var cancelBtn = pop.querySelector('[data-action="cancel"]');
    var errEl = pop.querySelector('.comment-error');

    textInput.focus();

    cancelBtn.addEventListener('click', closePopover);
    submitBtn.addEventListener('click', doSubmit);
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closePopover(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); doSubmit(); }
    });

    function doSubmit() {
      var text = (textInput.value || '').trim();
      errEl.hidden = true;
      if (!text) { showErr('Comment text is required.'); return; }
      if (text.length > 2000) { showErr('Too long (max 2000 characters).'); return; }
      safeStorage('set', AUTHOR_KEY, author);
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      submitBtn.textContent = 'Posting…';
      fetch(cloudUrl + '/api/comment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shareId: shareId, anchor: anchor, author: author, text: text })
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            var msg = t;
            try { var j = JSON.parse(t); if (j && j.error) msg = j.error; } catch (_) {}
            throw new Error(msg || ('HTTP ' + res.status));
          });
        }
        return res.json();
      }).then(function (data) {
        if (data && data.comment) receiveComment(data.comment);
        closePopover();
      }).catch(function (err) {
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
        submitBtn.textContent = 'Post';
        showErr('Failed: ' + (err && err.message ? err.message : String(err)));
      });
    }
    function showErr(m) { errEl.hidden = false; errEl.textContent = m; }
  }

  function openReadPopover(comment, x, y) {
    closePopover();
    var pop = document.createElement('div');
    pop.className = 'read-popover';
    pop.innerHTML = [
      '<div class="comment-drag" data-drag-handle aria-label="Drag to move"><span class="comment-grip" aria-hidden="true">⋮⋮</span></div>',
      '<div class="read-meta"><span class="author">' + esc(comment.author || 'Reviewer') + '</span><span class="ts">' + esc(formatTs(comment.ts)) + '</span></div>',
      '<div class="read-body">' + esc(comment.text || '') + '</div>',
      '<div class="comment-actions"><button type="button" class="comment-btn ghost" data-action="close">Close</button></div>'
    ].join('');
    positionPopover(pop, x, y);
    shadow.appendChild(pop);
    popover = pop;
    makeDraggable(pop, pop.querySelector('[data-drag-handle]'));
    pop.querySelector('[data-action="close"]').addEventListener('click', closePopover);
  }

  // Clicks outside any popover close read popovers (keep composer sticky so
  // accidental clicks don't lose the reviewer's in-progress text). Clicks
  // inside the overlay retarget to the shadow host at the document level —
  // skip those so the close button and header drags don't dismiss on release.
  document.addEventListener('click', function (e) {
    if (!popover || !popover.classList.contains('read-popover')) return;
    if (e.target === host) return;
    closePopover();
  }, true);

  // ── Comment model + pin rendering
  function receiveComment(c) {
    if (!c || !c.id) return;
    if (pinByCommentId[c.id]) return; // dedupe (SSE broadcast + POST response race)
    comments.push(c);
    pinNumberById[c.id] = comments.length;
    renderPin(c);
  }

  function renderPin(c) {
    var pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'pin';
    var n = pinNumberById[c.id];
    pin.style.background = PIN_PALETTE[(n - 1) % PIN_PALETTE.length];
    pin.textContent = String(n);
    pin.setAttribute('aria-label', 'Comment ' + n + ' from ' + (c.author || 'Reviewer'));
    var pos = resolvePinPosition(c.anchor);
    pin.style.left = pos.x + 'px';
    pin.style.top = pos.y + 'px';
    pin.addEventListener('click', function (e) {
      e.stopPropagation();
      openReadPopover(c, pos.x, pos.y);
    });
    pinLayer.appendChild(pin);
    pinByCommentId[c.id] = pin;
  }

  function resolvePinPosition(anchor) {
    // Every anchor is viewport-% now. Legacy element-anchored comments from
    // older overlays carry x/y too (stored alongside cssSelector), so they
    // still render — just at their stored viewport fraction instead of
    // tracking the element.
    var ax = (anchor && typeof anchor.x === 'number') ? anchor.x : 50;
    var ay = (anchor && typeof anchor.y === 'number') ? anchor.y : 50;
    return { x: (ax / 100) * window.innerWidth, y: (ay / 100) * window.innerHeight };
  }

  function repositionAllPins() {
    for (var i = 0; i < comments.length; i++) {
      var c = comments[i];
      var pin = pinByCommentId[c.id];
      if (!pin) continue;
      var pos = resolvePinPosition(c.anchor);
      pin.style.left = pos.x + 'px';
      pin.style.top = pos.y + 'px';
    }
  }
  window.addEventListener('scroll', repositionAllPins, { passive: true });
  window.addEventListener('resize', repositionAllPins);

  // ── Utilities
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  function formatTs(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts || ''); }
  }
  function safeStorage(op, k, v) {
    try {
      if (op === 'get') return localStorage.getItem(k);
      if (op === 'set') localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }

  // ── Initial fetch of existing comments (so reloads + new viewers see prior)
  fetch(cloudUrl + '/api/share?id=' + encodeURIComponent(shareId))
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      if (data && data.comments && data.comments.length) {
        for (var i = 0; i < data.comments.length; i++) receiveComment(data.comments[i]);
      }
    })
    .catch(function () { /* silent — SSE reconnection will still feed new comments */ });

  // ── SSE stream — same endpoint the canvas live-share viewer uses.
  var es = null;
  var retry = 0;
  function connect() {
    try {
      var url = cloudUrl + '/api/share/' + encodeURIComponent(shareId) + '/stream';
      es = new EventSource(url, { withCredentials: false });
      es.addEventListener('open', function () {
        retry = 0;
        setDotState('connected');
      });
      es.addEventListener('error', function () {
        setDotState('disconnected');
        if (es) { es.close(); es = null; }
        var delay = Math.min(MAX_RETRY_MS, 1000 * Math.pow(2, retry++));
        setTimeout(connect, delay);
      });
      es.addEventListener('comment', function (ev) {
        try {
          var c = JSON.parse(ev.data);
          receiveComment(c);
        } catch (e) {}
      });
    } catch (e) {
      setDotState('disconnected');
    }
  }
  connect();
  setIdleLabel();
})();
`;
