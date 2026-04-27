// tools.ts — Tool definitions for the Frank MCP server.
//
// v1 is READ-ONLY. Every tool translates to a WS call against the running
// Frank daemon. Write + share tools land in a follow-up once the daemon →
// browser canvas-state broadcast is in place (otherwise AI-authored shapes
// wouldn't show up in the user's open canvas until refresh).
//
// Any daemon reply of `type: 'error'` becomes a structured MCP tool error so
// the AI can see the actual reason (e.g. "Project not found"). Replies that
// don't look like errors are returned as the tool's JSON result.

import type { DaemonBridge } from './bridge.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function asError(reply: unknown): string | null {
  if (reply && typeof reply === 'object' && (reply as { type?: string }).type === 'error') {
    return (reply as { error?: string }).error || 'unknown error';
  }
  return null;
}

export function buildTools(bridge: DaemonBridge): Tool[] {
  const tools: Tool[] = [];

  tools.push({
    name: 'list_projects',
    description: 'List every Frank project on this machine with id, name, content type, comment count, and lifecycle flags (archived / trashed).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler() {
      const reply = await bridge.send({ type: 'list-projects' });
      const err = asError(reply); if (err) throw new Error(err);
      return (reply as { projects: unknown[] }).projects;
    },
  });

  tools.push({
    name: 'load_project',
    description: 'Fetch a project\'s full metadata (name, url/file, contentType, screens, activeShare, intent) and every comment anchored to it. Use this after list_projects when you need to read anything about a specific project.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string', description: 'The project id from list_projects.' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'load-project', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      const { project, comments } = reply as { project: unknown; comments: unknown };
      return { project, comments };
    },
  });

  tools.push({
    name: 'get_intent',
    description: 'Return the project\'s "intent" — the brief the user wrote about what they\'re building and what success looks like. Empty string if unset. Always prepend this to any work you do: feedback should be read against this goal, not in a vacuum.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'load-project', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      const project = (reply as { project: { intent?: string } }).project;
      return { intent: project.intent || '' };
    },
  });

  tools.push({
    name: 'get_comments',
    description: 'Return every comment anchored to a project: id, author, text, status (pending / approved / dismissed / remixed), anchor (css selector for URL projects, shape id for canvas projects, visual coords for free pins), and timestamp. Filter on status="approved" if you want the curated set the user has marked to act on.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'load-project', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      return (reply as { comments: unknown[] }).comments;
    },
  });

  tools.push({
    name: 'get_canvas_state',
    description: 'Return the serialized Konva canvas state as a JSON string. Only works on canvas projects. The structure follows Konva\'s standard serialization — a root Layer with `children` shapes.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'load-canvas-state', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      return { state: (reply as { state: string | null }).state };
    },
  });

  tools.push({
    name: 'list_snapshots',
    description: 'List the snapshot bookmarks for a project — each one is a moment in time the user (or an automated flow) captured. Returns id, trigger, label, starred flag, canvas / DOM variant, and timestamp.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'list-snapshots', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      return (reply as { snapshots: unknown[] }).snapshots;
    },
  });

  tools.push({
    name: 'get_timeline',
    description: 'Return the project\'s chronological activity timeline — comments, curations, snapshots, and AI-instruction log entries in a single list sorted oldest-first. Useful for understanding how a project evolved.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'export-project', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      const data = (reply as { data: { timeline: unknown[] } }).data;
      return data.timeline;
    },
  });

  // ─── Canvas write tools ──────────────────────────────────────────────────

  tools.push({
    name: 'add_shape',
    description: 'Append a shape to a canvas project. The shape is placed in world coordinates (x, y = top-left of the bounding box). Kinds: rectangle, circle, ellipse, triangle, diamond, hexagon, star, sticky, parallelogram, document, cylinder, cloud, speech. Optional text is placed as a centered label on the shape (ignored for sticky — sticky\'s fill carries the note; put the text in a separate add_text if you need it). Returns { id } — pass that id to add_connector to link shapes.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        kind: { type: 'string', enum: ['rectangle','circle','ellipse','triangle','diamond','hexagon','star','sticky','parallelogram','document','cylinder','cloud','speech'] },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string', description: 'Optional label rendered at the shape\'s center.' },
        fill: { type: 'string', description: 'Optional CSS color.' },
        stroke: { type: 'string', description: 'Optional CSS color.' },
      },
      required: ['projectId', 'kind', 'x', 'y'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-add-shape',
        projectId: String(args.projectId),
        kind: String(args.kind) as never,
        x: Number(args.x), y: Number(args.y),
        width: args.width != null ? Number(args.width) : undefined,
        height: args.height != null ? Number(args.height) : undefined,
        text: args.text != null ? String(args.text) : undefined,
        fill: args.fill != null ? String(args.fill) : undefined,
        stroke: args.stroke != null ? String(args.stroke) : undefined,
      });
      const err = asError(reply); if (err) throw new Error(err);
      return { id: (reply as { id: string }).id };
    },
  });

  tools.push({
    name: 'add_text',
    description: 'Append a standalone text node to a canvas project at (x, y). For labeling a shape, prefer add_shape with a `text` argument so the label sticks to the shape\'s center. Returns { id }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' },
        fontSize: { type: 'number' },
      },
      required: ['projectId', 'x', 'y', 'text'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-add-text',
        projectId: String(args.projectId),
        x: Number(args.x), y: Number(args.y),
        text: String(args.text),
        fontSize: args.fontSize != null ? Number(args.fontSize) : undefined,
      });
      const err = asError(reply); if (err) throw new Error(err);
      return { id: (reply as { id: string }).id };
    },
  });

  tools.push({
    name: 'add_path',
    description: 'Append a freehand path (pen tool). Points is a flat array alternating x and y world coordinates: [x1,y1,x2,y2,...]. Needs at least 2 points (4 numbers). Rarely the right tool for AI — prefer structured shapes + connectors. Exposed for parity with the canvas toolbar. Returns { id }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        points: { type: 'array', items: { type: 'number' }, minItems: 4 },
        stroke: { type: 'string' },
      },
      required: ['projectId', 'points'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-add-path',
        projectId: String(args.projectId),
        points: args.points as number[],
        stroke: args.stroke != null ? String(args.stroke) : undefined,
      });
      const err = asError(reply); if (err) throw new Error(err);
      return { id: (reply as { id: string }).id };
    },
  });

  tools.push({
    name: 'add_connector',
    description: 'Draw a connector between two shapes. Kind is "arrow" (straight line with arrowhead) or "elbow" (right-angle path). fromId and toId are shape ids returned by add_shape. Endpoints snap to the nearest of 8 anchor points on each shape (corners + edge midpoints) — same scheme as user-drawn connectors — and the connector binds to its source/target so it follows the shapes when the user moves or rotates them. Returns { id }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        fromId: { type: 'string' },
        toId: { type: 'string' },
        kind: { type: 'string', enum: ['arrow', 'elbow'] },
      },
      required: ['projectId', 'fromId', 'toId', 'kind'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-add-connector',
        projectId: String(args.projectId),
        fromId: String(args.fromId),
        toId: String(args.toId),
        kind: String(args.kind) as 'arrow' | 'elbow',
      });
      const err = asError(reply); if (err) throw new Error(err);
      return { id: (reply as { id: string }).id };
    },
  });

  tools.push({
    name: 'add_comment',
    description: 'Add a comment to a project. On canvas projects, pass shapeId to anchor to a specific shape — the pin will follow it, and x/y default to the shape\'s centre if omitted. On URL / PDF / image projects, pass x and y as percentages of the viewport (0–100). author defaults to "AI" if unset. Comments added here appear in the user\'s feedback panel like any other. Returns { id }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        shapeId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' },
        author: { type: 'string' },
      },
      required: ['projectId', 'text'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-add-comment',
        projectId: String(args.projectId),
        shapeId: args.shapeId != null ? String(args.shapeId) : undefined,
        x: args.x != null ? Number(args.x) : undefined,
        y: args.y != null ? Number(args.y) : undefined,
        text: String(args.text),
        author: args.author != null ? String(args.author) : undefined,
      });
      const err = asError(reply); if (err) throw new Error(err);
      return { id: (reply as { id: string }).id };
    },
  });

  tools.push({
    name: 'insert_template',
    description: 'Intended to insert a pre-made template (kanban / mindmap / flowchart / calendar). NOT YET SUPPORTED in v1 — the template definitions live only in the browser. For now, compose the layout from add_shape + add_connector calls. This tool exists so future versions can slot it in without renaming.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        template: { type: 'string', enum: ['kanban', 'mindmap', 'flowchart', 'calendar'] },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['projectId', 'template', 'x', 'y'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-insert-template',
        projectId: String(args.projectId),
        template: String(args.template) as never,
        x: Number(args.x), y: Number(args.y),
      });
      const err = asError(reply); if (err) throw new Error(err);
      return reply;
    },
  });

  tools.push({
    name: 'create_share',
    description: 'Create a new share link for a canvas project. Uploads a snapshot of the current canvas to the user\'s configured Frank cloud. v1 is canvas-only — URL / PDF / image projects need the share modal in the Frank UI because their snapshot builder runs in the browser. The author\'s own comments stay local by design; the share starts empty and fills as reviewers add comments. Optional coverNote shows on the reviewer\'s landing page. expiryDays defaults to 7. Returns { shareId, url, revokeToken, expiresAt }.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        coverNote: { type: 'string' },
        expiryDays: { type: 'number', enum: [1, 7, 30, 90, 365] },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({
        type: 'mcp-create-share',
        projectId: String(args.projectId),
        coverNote: args.coverNote != null ? String(args.coverNote) : undefined,
        expiryDays: args.expiryDays != null ? Number(args.expiryDays) : undefined,
      });
      const err = asError(reply); if (err) throw new Error(err);
      const r = reply as { shareId: string; url: string; revokeToken: string; expiresAt: string };
      return { shareId: r.shareId, url: r.url, revokeToken: r.revokeToken, expiresAt: r.expiresAt };
    },
  });

  tools.push({
    name: 'export_bundle',
    description: 'Produce a complete project archive (a zip file) containing project.json, report.md, report.pdf, canvas-state.json, every snapshot folder, the source file (if any), and canvas assets. Returns { data, filename, mimeType } where data is base64-encoded zip bytes. Use this when the user asks to "hand off everything" to an AI or stakeholder.',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false,
    },
    async handler(args) {
      const reply = await bridge.send({ type: 'export-bundle', projectId: String(args.projectId) });
      const err = asError(reply); if (err) throw new Error(err);
      const r = reply as { mimeType: string; filename: string; data: string };
      return { mimeType: r.mimeType, filename: r.filename, base64: r.data };
    },
  });

  return tools;
}
