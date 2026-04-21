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

  tools.push({
    name: 'export_bundle',
    description: 'Produce a complete project archive (a zip file) containing project.json, report.md, report.pdf, canvas-state.json, every snapshot folder, the source file (if any), and canvas assets. Returns the bundle as base64-encoded zip bytes plus the suggested filename. Use this when the user asks to "hand off everything" to an AI or stakeholder.',
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
