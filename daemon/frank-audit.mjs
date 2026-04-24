#!/usr/bin/env node
// Frank MCP + CLI quality audit.
//
// Exercises every tool / subcommand with assertions that judge OUTPUT QUALITY,
// not just "it didn't throw." Passes only when results are usable by an AI
// (intent-relevant fields populated, IDs returned, round-trip visible in state).

import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

const results = [];
function assert(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  const mark = cond ? PASS : FAIL;
  console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`);
  return !!cond;
}

// ─── CLI tests ──────────────────────────────────────────────────────────────

async function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn('frank', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => out += d.toString());
    child.stderr.on('data', (d) => err += d.toString());
    child.on('close', (code) => resolve({ code, out, err }));
    if (opts.timeoutMs) setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
  });
}

async function testCli() {
  console.log('\n\x1b[1m== CLI audit ==\x1b[0m');

  const helpArgs = [''];
  for (const a of helpArgs) {
    const { out, code } = await runCli(a ? [a] : [], { timeoutMs: 5000 });
    assert(`frank (no-arg help) exits 0`, code === 0);
    assert(`help lists every subcommand`,
      ['start','stop','connect','status','export','mcp','share','uninstall']
        .every(cmd => out.includes(` ${cmd} `) || out.includes(` ${cmd}\n`)),
      `commands found: ${['start','stop','connect','status','export','mcp','share','uninstall'].filter(cmd => out.includes(cmd)).length}/8`);
    assert(`help is actionable (not just names)`, out.split('\n').filter(l => /^\s{2}\w+\s+\w/.test(l)).length >= 7,
      'subcommands should each have a one-liner');
  }

  const { out: status, code: statusCode } = await runCli(['status'], { timeoutMs: 5000 });
  assert('frank status exits 0', statusCode === 0);
  assert('status shows cloud state', /cloud:/i.test(status));
  assert('status shows health when connected', /not connected|health:/i.test(status));

  const { out: shareList, code: shareListCode } = await runCli(['share', 'list'], { timeoutMs: 10000 });
  assert('frank share list exits 0', shareListCode === 0);
  // Either "no active shares" or a structured list
  const isEmpty = /no active shares/i.test(shareList);
  const hasStructure = /share link:|deployment:|expires:/i.test(shareList);
  assert('share list is structured (empty or populated)', isEmpty || hasStructure,
    isEmpty ? 'empty' : (hasStructure ? 'populated with expected fields' : 'unparseable'));

  const { code: badShareCode, err: badShareErr } = await runCli(['share', 'revoke'], { timeoutMs: 3000 });
  assert('share revoke without id exits nonzero', badShareCode !== 0);
  assert('share revoke prints usage', /shareId/i.test(badShareErr));

  const { code: badExportCode, out: badExportOut } = await runCli(['export'], { timeoutMs: 3000 });
  assert('export without id exits nonzero', badExportCode !== 0);
  assert('export prints usage', /Usage:.*export/i.test(badExportOut));
}

// ─── MCP tests ──────────────────────────────────────────────────────────────

async function connectMcp() {
  const transport = new StdioClientTransport({
    command: 'frank',
    args: ['mcp'],
  });
  const client = new Client({ name: 'frank-audit', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

function parseContent(result) {
  if (result?.isError) return { error: result.content?.[0]?.text || 'unknown error' };
  const text = result?.content?.[0]?.text;
  if (!text) return { raw: result };
  try { return { json: JSON.parse(text) }; }
  catch { return { text }; }
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { result, parsed: parseContent(result) };
}

async function testMcp() {
  console.log('\n\x1b[1m== MCP audit ==\x1b[0m');
  const { client } = await connectMcp();

  // Tool list
  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  const EXPECTED = [
    'list_projects','load_project','get_intent','get_comments','get_canvas_state',
    'list_snapshots','get_timeline','export_bundle',
    'add_shape','add_text','add_path','add_connector','add_comment',
    'insert_template','create_share',
  ];
  assert('MCP exposes all 15 tools', EXPECTED.every(n => names.includes(n)),
    `got ${names.length}: ${names.sort().join(', ')}`);
  assert('every tool description >= 40 chars (actionable for AI)',
    listed.tools.every(t => t.description && t.description.length >= 40),
    listed.tools.filter(t => !t.description || t.description.length < 40).map(t => t.name).join(', ') || 'all pass');
  assert('every tool has inputSchema.type === "object"',
    listed.tools.every(t => t.inputSchema?.type === 'object'));

  // list_projects — quality: each has id, name, contentType, modified, commentCount
  const { parsed: lp } = await call(client, 'list_projects');
  const projects = Array.isArray(lp.json) ? lp.json : [];
  assert('list_projects returns an array', Array.isArray(lp.json), `got ${typeof lp.json}`);
  assert('list_projects projects have { name, projectId, contentType, commentCount, modified }',
    projects.length === 0 || projects.every(p =>
      typeof p.name === 'string' && typeof p.projectId === 'string'
      && typeof p.contentType === 'string' && typeof p.commentCount === 'number'
      && typeof p.modified === 'string'),
    projects.length ? `${projects.length} projects` : 'no projects (skipped shape check)');
  assert('list_projects includes at least one project for this audit',
    projects.length >= 1, `found ${projects.length}`);

  // Pick a canvas project + a URL project for targeted tests
  const canvasProject = projects.find(p => p.contentType === 'canvas');
  const urlProject = projects.find(p => p.contentType === 'url');
  assert('at least one canvas project exists', !!canvasProject, canvasProject?.projectId);
  assert('at least one URL project exists', !!urlProject, urlProject?.projectId);
  const targetId = canvasProject?.projectId || projects[0]?.projectId;
  if (!targetId) { console.log('no projects — skipping remainder'); return; }

  // load_project — quality: full project shape plus comments
  const { parsed: loaded } = await call(client, 'load_project', { projectId: targetId });
  assert('load_project returns { project, comments }',
    loaded.json && typeof loaded.json.project === 'object' && Array.isArray(loaded.json.comments),
    `keys: ${loaded.json ? Object.keys(loaded.json).join(', ') : 'none'}`);
  const project = loaded.json?.project;
  assert('loaded project has frank_version, name, contentType, created, modified',
    project && ['frank_version','name','contentType','created','modified'].every(k => k in project));

  // get_intent — quality: returns string field "intent"
  const { parsed: intent } = await call(client, 'get_intent', { projectId: targetId });
  assert('get_intent returns { intent: string }',
    intent.json && typeof intent.json.intent === 'string',
    `type = ${intent.json ? typeof intent.json.intent : 'null'}`);

  // get_comments — quality: each comment has id, anchor, author, text, ts, status
  const { parsed: comments } = await call(client, 'get_comments', { projectId: targetId });
  const cArr = Array.isArray(comments.json) ? comments.json : [];
  assert('get_comments returns an array', Array.isArray(comments.json));
  if (cArr.length) {
    const c = cArr[0];
    assert('comment shape {id, anchor, author, text, ts, status}',
      ['id','anchor','author','text','ts','status'].every(k => k in c),
      `keys: ${Object.keys(c).join(', ')}`);
    assert('status values are valid',
      cArr.every(x => ['pending','approved','dismissed','remixed'].includes(x.status)),
      `statuses: ${[...new Set(cArr.map(x => x.status))].join(', ')}`);
    assert('anchor has a type',
      cArr.every(x => x.anchor && typeof x.anchor.type === 'string'),
      `anchor types: ${[...new Set(cArr.map(x => x.anchor?.type))].join(', ')}`);
  } else {
    console.log(`${INFO} no comments on ${targetId} — comment-shape assertions skipped`);
  }

  // get_canvas_state — quality: canvas projects yield valid JSON, non-canvas yield null
  if (canvasProject) {
    const { parsed: state } = await call(client, 'get_canvas_state', { projectId: canvasProject.projectId });
    assert('get_canvas_state on canvas project returns { state }',
      state.json && 'state' in state.json);
    const stateStr = state.json?.state;
    if (typeof stateStr === 'string' && stateStr.length) {
      try {
        const parsed = JSON.parse(stateStr);
        assert('canvas state parses as valid Konva JSON',
          parsed && (parsed.attrs !== undefined || parsed.children !== undefined || parsed.className !== undefined),
          `root keys: ${Object.keys(parsed).join(', ')}`);
      } catch (e) {
        assert('canvas state parses as valid Konva JSON', false, e.message);
      }
    } else {
      console.log(`${INFO} canvas state is empty string/null — ok for brand-new canvas`);
    }
  }
  if (urlProject) {
    const { parsed: state } = await call(client, 'get_canvas_state', { projectId: urlProject.projectId });
    assert('get_canvas_state on URL project returns null state',
      state.json?.state === null);
  }

  // list_snapshots — quality: array, each with id and ts if populated
  const { parsed: snaps } = await call(client, 'list_snapshots', { projectId: targetId });
  assert('list_snapshots returns array', Array.isArray(snaps.json));
  if (Array.isArray(snaps.json) && snaps.json.length) {
    assert('each snapshot has id + ts',
      snaps.json.every(s => typeof s.id === 'string' && typeof s.ts === 'string'));
  }

  // get_timeline — quality: array of events with sensible types
  const { parsed: timeline } = await call(client, 'get_timeline', { projectId: targetId });
  assert('get_timeline returns array', Array.isArray(timeline.json));
  if (Array.isArray(timeline.json) && timeline.json.length) {
    assert('timeline events have a type field',
      timeline.json.every(e => typeof e.type === 'string'));
    // Chronologically sorted ascending?
    const tss = timeline.json.map(e => e.ts).filter(Boolean);
    let sorted = true;
    for (let i = 1; i < tss.length; i++) if (tss[i] < tss[i-1]) { sorted = false; break; }
    assert('timeline is sorted oldest-first', sorted);
  }

  // export_bundle — quality: returns base64 + valid mimeType + filename
  const { parsed: bundle } = await call(client, 'export_bundle', { projectId: targetId });
  const b = bundle.json;
  assert('export_bundle returns {base64, filename, mimeType}',
    b && typeof b.base64 === 'string' && typeof b.filename === 'string' && typeof b.mimeType === 'string',
    b ? `${b.filename} (${b.mimeType}, ${b.base64?.length ?? 0} b64 chars)` : 'null');
  if (b?.base64) {
    const buf = Buffer.from(b.base64, 'base64');
    assert('bundle base64 decodes to a zip (starts PK)',
      buf[0] === 0x50 && buf[1] === 0x4B, `first bytes: ${buf.slice(0,4).toString('hex')}`);
    // Write + open to check contents
    const tmp = path.join(os.tmpdir(), `frank-audit-${Date.now()}.zip`);
    fs.writeFileSync(tmp, buf);
    assert('bundle filename matches zip extension', b.filename.endsWith('.zip'));
    fs.unlinkSync(tmp);
  }

  // ─── Canvas write tools (only if we have a canvas project) ────────────────
  if (canvasProject) {
    const cid = canvasProject.projectId;
    const tag = `audit-${Date.now()}`;

    // Baseline state. Canvas-state format (from canvas-writes.ts) is flat:
    // { version, children: [node, node, ...] } — no Stage → Layer wrapper.
    const { parsed: before } = await call(client, 'get_canvas_state', { projectId: cid });
    const beforeCount = before.json?.state ? (JSON.parse(before.json.state).children?.length ?? 0) : 0;

    const { parsed: shape } = await call(client, 'add_shape', {
      projectId: cid, kind: 'rectangle', x: 120, y: 140, width: 180, height: 100,
      text: tag + '-rect', fill: '#ffcc00',
    });
    assert('add_shape returns { id }', shape.json && typeof shape.json.id === 'string',
      shape.json?.id);

    const { parsed: shape2 } = await call(client, 'add_shape', {
      projectId: cid, kind: 'circle', x: 400, y: 140, width: 120, height: 120,
      text: tag + '-circle',
    });
    assert('add_shape circle returns { id }', shape2.json && typeof shape2.json.id === 'string');

    const { parsed: text } = await call(client, 'add_text', {
      projectId: cid, x: 600, y: 200, text: tag + '-text', fontSize: 18,
    });
    assert('add_text returns { id }', text.json && typeof text.json.id === 'string');

    const { parsed: connector } = await call(client, 'add_connector', {
      projectId: cid, fromId: shape.json.id, toId: shape2.json.id, kind: 'arrow',
    });
    assert('add_connector returns { id }', connector.json && typeof connector.json.id === 'string');

    // State observation — quality: all four new nodes are in the serialized JSON.
    // add_shape with `text` also appends a separate text node for the label, so
    // writing two labelled shapes + one standalone text + one connector = 6 new
    // nodes. This exposes whether writes actually persist + the label-node
    // behavior documented in add_shape's description.
    const { parsed: after } = await call(client, 'get_canvas_state', { projectId: cid });
    const afterParsed = after.json?.state ? JSON.parse(after.json.state) : null;
    const afterChildren = afterParsed?.children ?? [];
    const afterCount = afterChildren.length;
    assert('canvas state grows by 6 after 2 labelled shapes + text + connector',
      afterCount === beforeCount + 6,
      `before=${beforeCount} after=${afterCount} (expected +6)`);

    // Verify IDs are present
    const serialised = JSON.stringify(afterChildren);
    assert('shape rect is findable by id', serialised.includes(shape.json.id));
    assert('connector is findable by id', serialised.includes(connector.json.id));
    assert('text label survives in serialized state', serialised.includes(tag + '-rect'));

    // Shape quality — rectangle should serialize to className: "Rect" with
    // the exact coords we passed. Matches what the browser canvas produces,
    // so the AI-written node renders identically to a user-drawn one.
    const writtenRect = afterChildren.find(n => n.attrs?.id === shape.json.id);
    assert('rectangle serialises as className: "Rect"', writtenRect?.className === 'Rect',
      `got ${writtenRect?.className}`);
    assert('rectangle preserves passed coords (x=120, y=140, w=180, h=100)',
      writtenRect && writtenRect.attrs.x === 120 && writtenRect.attrs.y === 140
        && writtenRect.attrs.width === 180 && writtenRect.attrs.height === 100);
    assert('rectangle carries draggable=true (matches user-drawn shapes)',
      writtenRect?.attrs?.draggable === true);
    const writtenCircle = afterChildren.find(n => n.attrs?.id === shape2.json.id);
    assert('circle serialises as className: "Ellipse" (Konva convention)',
      writtenCircle?.className === 'Ellipse', `got ${writtenCircle?.className}`);

    // add_path test (separate, since it's the one write we didn't exercise)
    const { parsed: pathRes } = await call(client, 'add_path', {
      projectId: cid, points: [50, 50, 80, 60, 110, 40, 140, 55],
    });
    assert('add_path returns { id }', pathRes.json && typeof pathRes.json.id === 'string');
    const { parsed: afterPath } = await call(client, 'get_canvas_state', { projectId: cid });
    const afterPathChildren = afterPath.json?.state ? JSON.parse(afterPath.json.state).children : [];
    const pathNode = afterPathChildren.find(n => n.attrs?.id === pathRes.json?.id);
    assert('path node exists with className Line', pathNode?.className === 'Line',
      `got ${pathNode?.className}`);
    assert('path preserves point array', Array.isArray(pathNode?.attrs?.points) && pathNode.attrs.points.length === 8);

    // add_comment — quality: must appear in get_comments
    const { parsed: comment } = await call(client, 'add_comment', {
      projectId: cid, text: tag + '-comment', shapeId: shape.json.id,
    });
    assert('add_comment returns { id }', comment.json && typeof comment.json.id === 'string');
    const { parsed: commentsAfter } = await call(client, 'get_comments', { projectId: cid });
    const newComment = (commentsAfter.json || []).find(c => c.id === comment.json?.id);
    assert('new comment appears in get_comments', !!newComment,
      newComment ? `author=${newComment.author} status=${newComment.status}` : 'missing');
    assert('new comment anchor is shape-typed', newComment?.anchor?.type === 'shape' && newComment?.anchor?.shapeId === shape.json.id);

    // insert_template — quality: surfaces the "not supported" message cleanly
    try {
      const { result } = await call(client, 'insert_template', { projectId: cid, template: 'kanban', x: 0, y: 0 });
      assert('insert_template returns isError (v1 stub)', result.isError === true,
        result.isError ? result.content?.[0]?.text : 'unexpectedly succeeded');
    } catch (e) {
      assert('insert_template surfaces a user-facing error (v1 stub)', true, e.message);
    }
  }

  // Error-path quality: calling load_project on a bogus id returns a structured error
  const { result: badLoad } = await call(client, 'load_project', { projectId: 'does-not-exist-xyz' });
  assert('load_project with bad id returns isError=true', badLoad.isError === true,
    badLoad.isError ? badLoad.content?.[0]?.text : 'did not error');
  assert('error message names the problem',
    /not exist|no such|not found|enoent|cannot find|cant find/i.test(badLoad.content?.[0]?.text || ''),
    badLoad.content?.[0]?.text?.slice(0, 80));

  // Read-only guard: no tool should be listed that enables revoke / live-share / delete-project
  const FORBIDDEN = ['revoke_share','stop_live_share','start_live_share','resume_live_share','delete_project','trash_project'];
  assert('no forbidden user-driven tools exposed via MCP',
    FORBIDDEN.every(n => !names.includes(n)),
    FORBIDDEN.filter(n => names.includes(n)).join(', ') || 'none');

  await client.close().catch(() => {});
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await testCli();
    await testMcp();
  } catch (e) {
    console.error('\n\x1b[31mTEST HARNESS ERROR:\x1b[0m', e?.stack || e);
    process.exitCode = 1;
  }
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n\x1b[1m${pass}/${results.length} pass, ${fail} fail\x1b[0m`);
  if (fail) {
    console.log('\nFailed checks:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ${FAIL} ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
    process.exitCode = 1;
  }
})();
