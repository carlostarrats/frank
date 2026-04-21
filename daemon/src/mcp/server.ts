// server.ts — `frank mcp` entry point. Runs a Model Context Protocol server
// over stdio so AI clients (Claude Desktop, Claude Code, Cursor, etc.) can
// read Frank projects and — in a follow-up — create content inside them.
//
// Transport: stdio only. There's no HTTP / TCP listener, so the server has
// zero network surface. MCP clients spawn this as a subprocess and pipe
// stdin/stdout; it dies with the parent session.
//
// Behavior on missing daemon: the subprocess stays alive but every tool call
// returns a structured error telling the user to run `frank start`. We do not
// boot the daemon ourselves — that would race with the user's own `frank
// start` and cause double-port-listen crashes.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DaemonBridge } from './bridge.js';
import { buildTools } from './tools.js';

// Shown to the AI client when it loads the tool list. Explicitly calls out
// which categories of action live in the Frank UI (not here) so the AI tells
// the user to act there instead of guessing at a tool that doesn't exist.
const SERVER_INSTRUCTIONS = `
Frank MCP server — local-first collaboration layer.

Use these tools to read a Frank project's content (comments, canvas state,
snapshots, timeline) and hand off context to the current AI session. A
project "intent" (the brief the user wrote about what they're building)
rides along with every export — prefer to read it first so your work is
framed against the actual goal.

Intentionally NOT exposed here (user drives these from the Frank UI):
  • Revoking a share link
  • Starting, pausing, or resuming a live share
  • Deleting or purging projects
  • Approving / dismissing comments (curation is a human decision)

If the user asks for any of the above, tell them to perform it in the Frank
UI. Do not attempt a workaround.
`.trim();

export async function runMcpServer(): Promise<void> {
  const bridge = new DaemonBridge();
  // Best-effort connect. If the daemon isn't running, tool calls will
  // surface the error; we do not abort startup so Claude Desktop sees the
  // server come online and can surface a clean error on the first call.
  try { await bridge.connect(); } catch { /* tool calls will report */ }

  const tools = buildTools(bridge);
  const toolByName = new Map(tools.map(t => [t.name, t]));

  const server = new Server(
    { name: 'frank', version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const tool = toolByName.get(name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      };
    }
    try {
      const result = await tool.handler(args ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (e: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: e?.message ? String(e.message) : 'tool failed' }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
