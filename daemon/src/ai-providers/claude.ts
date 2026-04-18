// Claude API client for Frank's in-app AI panel.
//
// Two exports:
//   buildContext(...) — assembles the system prompt + message list for a turn,
//                       applying the per-section budgets below so we never
//                       blow through the context window.
//   streamChat(...)    — streams Claude's response via @anthropic-ai/sdk.
//
// Budgeting is char-approximate (≈4 chars per token). Exact token counting
// would add a round trip per turn; the approximation is good enough and keeps
// the per-section caps honest. Logs report byte/char counts only — never
// content — for observability.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from '../protocol.js';
import type { Conversation, ConversationMessage } from '../ai-conversations.js';
import { loadProject, loadComments } from '../projects.js';
import { listSnapshots } from '../snapshots.js';
import { loadCanvasState } from '../canvas.js';

const CHARS_PER_TOKEN = 4;
const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
// Soft ceiling on total prompt tokens — leaves room for the response plus
// any adaptive-thinking overhead inside Claude's 200K window.
const TOTAL_PROMPT_TOKEN_CAP = 180_000;

const SECTION_BUDGETS = {
  preambleTokens: 500,
  canvasTokens: 3_000,
  commentsTokens: 2_000,
  snapshotsTokens: 1_000,
} as const;

const SYSTEM_PROMPT = `You are Frank, an in-app collaboration assistant helping a developer-designer iterate on what they are building.

The messages you see include curated reviewer feedback, recent snapshot metadata, and (when relevant) a sketch of the current canvas. Treat this context as the source of truth about the project. Reference specific comments by author when relevant.

Be concise. Skip preamble. When proposing changes, ground them in the specific feedback or snapshot being iterated on. If you need information that isn't in the project context, say so and ask for it.`;

export interface BudgetReport {
  systemChars: number;
  preambleChars: number;
  canvasChars: number;
  commentsChars: number;
  snapshotsChars: number;
  historyChars: number;
  userMessageChars: number;
  totalChars: number;
  approxTokens: number;
}

export interface BuiltContext {
  system: string;
  messages: Anthropic.MessageParam[];
  report: BudgetReport;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 20)) + '\n…[truncated]';
}

function tokensToChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

function buildProjectPreamble(projectId: string): string {
  try {
    const project = loadProject(projectId);
    const lines = [
      `Project: ${project.name}`,
      `Type: ${project.contentType}`,
    ];
    if (project.url) lines.push(`URL: ${project.url}`);
    const screenCount = Object.keys(project.screens || {}).length;
    if (screenCount) lines.push(`Screens: ${screenCount}`);
    lines.push(`Created: ${project.created}`);
    lines.push(`Modified: ${project.modified}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}

function buildCanvasBlock(projectId: string, charBudget: number): string {
  const state = loadCanvasState(projectId);
  if (!state) return '';
  // Full JSON is usually too large. Summarize if over budget.
  if (state.length <= charBudget) {
    return `Canvas state (Konva JSON):\n${state}`;
  }
  try {
    const parsed = JSON.parse(state);
    const children = Array.isArray(parsed.children) ? parsed.children : [];
    const counts: Record<string, number> = {};
    for (const c of children) {
      const name = (c && c.className) || 'Unknown';
      counts[name] = (counts[name] || 0) + 1;
    }
    const summary = Object.entries(counts)
      .map(([k, v]) => `${v}× ${k}`)
      .join(', ') || '(empty)';
    return `Canvas summary: ${children.length} shapes (${summary}). Full JSON omitted for context budget.`;
  } catch {
    return truncate(`Canvas state:\n${state}`, charBudget);
  }
}

function buildCommentsBlock(projectId: string, charBudget: number): string {
  try {
    const all = loadComments(projectId);
    const pending = all.filter((c) => c.status === 'pending' || c.status === 'approved' || c.status === 'remixed');
    if (pending.length === 0) return '';
    // Prefer the most recent. Build from newest backward, stop when over budget.
    const byRecent = [...pending].sort((a, b) => b.ts.localeCompare(a.ts));
    const lines: string[] = [];
    let used = 0;
    const header = `Curated reviewer comments (${pending.length} total, showing most recent):`;
    used += header.length;
    lines.push(header);
    for (const c of byRecent) {
      const anchor = c.anchor?.cssSelector || `(${c.anchor?.x ?? '?'},${c.anchor?.y ?? '?'})`;
      const line = `- [${c.status}] ${c.author} on ${anchor}: ${c.text}`;
      if (used + line.length + 1 > charBudget) {
        lines.push(`- …${pending.length - (lines.length - 1)} more omitted`);
        break;
      }
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

function buildSnapshotsBlock(projectId: string, charBudget: number): string {
  try {
    const snaps = listSnapshots(projectId).slice(0, 10);
    if (snaps.length === 0) return '';
    const lines: string[] = [`Recent snapshots (${snaps.length}):`];
    for (const s of snaps) {
      const labelPart = s.label ? ` — ${s.label}` : '';
      const triggerPart = s.trigger !== 'manual' ? ` [${s.trigger}]` : '';
      lines.push(`- ${s.id} @ ${s.ts}${triggerPart}${labelPart}`);
    }
    return truncate(lines.join('\n'), charBudget);
  } catch {
    return '';
  }
}

function renderHistory(
  history: ConversationMessage[],
  charBudget: number,
): Anthropic.MessageParam[] {
  // Walk newest → oldest, keep as many verbatim as fit. Older turns get
  // summarized into a single synthetic turn at the front.
  const kept: ConversationMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const cost = m.content.length + m.role.length + 16;
    if (used + cost > charBudget && kept.length > 0) break;
    kept.unshift(m);
    used += cost;
  }

  const dropped = history.length - kept.length;
  const out: Anthropic.MessageParam[] = [];
  if (dropped > 0) {
    out.push({
      role: 'user',
      content: `[Earlier conversation summary: ${dropped} message(s) truncated for context budget. The most recent ${kept.length} turns follow verbatim.]`,
    });
  }
  for (const m of kept) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

export function buildContext(params: {
  projectId: string;
  conversation: Conversation;
  userMessage: string;
  feedbackIds?: string[];
}): BuiltContext {
  const preamble = truncate(
    buildProjectPreamble(params.projectId),
    tokensToChars(SECTION_BUDGETS.preambleTokens),
  );
  const canvas = buildCanvasBlock(params.projectId, tokensToChars(SECTION_BUDGETS.canvasTokens));
  const comments = buildCommentsBlock(params.projectId, tokensToChars(SECTION_BUDGETS.commentsTokens));
  const snapshots = buildSnapshotsBlock(params.projectId, tokensToChars(SECTION_BUDGETS.snapshotsTokens));

  const contextParts: string[] = [];
  if (preamble) contextParts.push(preamble);
  if (canvas) contextParts.push(canvas);
  if (comments) contextParts.push(comments);
  if (snapshots) contextParts.push(snapshots);

  // The system prompt is stable; putting project context as its own user
  // message keeps the system string a cleanly cacheable prefix.
  const contextMessage: Anthropic.MessageParam | null = contextParts.length
    ? { role: 'user', content: `<project-context>\n${contextParts.join('\n\n')}\n</project-context>` }
    : null;

  // Budget remaining for history: total cap minus everything else
  const systemChars = SYSTEM_PROMPT.length;
  const fixedChars =
    systemChars +
    (contextMessage ? (contextMessage.content as string).length : 0) +
    params.userMessage.length;
  const historyBudget = Math.max(0, TOTAL_PROMPT_TOKEN_CAP * CHARS_PER_TOKEN - fixedChars);
  const history = renderHistory(params.conversation.messages, historyBudget);

  const messages: Anthropic.MessageParam[] = [];
  if (contextMessage) messages.push(contextMessage);
  messages.push(...history);
  messages.push({ role: 'user', content: params.userMessage });

  const historyChars = history.reduce((acc, m) => {
    const s = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return acc + s.length;
  }, 0);

  const report: BudgetReport = {
    systemChars,
    preambleChars: preamble.length,
    canvasChars: canvas.length,
    commentsChars: comments.length,
    snapshotsChars: snapshots.length,
    historyChars,
    userMessageChars: params.userMessage.length,
    totalChars:
      systemChars +
      (contextMessage ? (contextMessage.content as string).length : 0) +
      historyChars +
      params.userMessage.length,
    approxTokens: 0,
  };
  report.approxTokens = Math.round(report.totalChars / CHARS_PER_TOKEN);

  // Observability: sizes only, never contents.
  console.log(
    `[frank] ai context built — approx ${report.approxTokens} tok ` +
      `(sys=${report.systemChars}c preamble=${report.preambleChars}c canvas=${report.canvasChars}c ` +
      `comments=${report.commentsChars}c snapshots=${report.snapshotsChars}c ` +
      `history=${report.historyChars}c user=${report.userMessageChars}c)`,
  );

  return { system: SYSTEM_PROMPT, messages, report };
}

// Streaming helper. Yields each text delta; returns the accumulated full text
// when the stream ends. Errors bubble — caller wraps in try/catch.
export async function streamChat(params: {
  apiKey: string;
  system: string;
  messages: Anthropic.MessageParam[];
  model?: string;
  onDelta: (delta: string) => void;
}): Promise<string> {
  const client = new Anthropic({ apiKey: params.apiKey });
  const stream = client.messages.stream({
    model: params.model || DEFAULT_MODEL,
    max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    system: [
      { type: 'text', text: params.system, cache_control: { type: 'ephemeral' } },
    ],
    messages: params.messages,
  });

  stream.on('text', (delta) => {
    params.onDelta(delta);
  });

  const finalMessage = await stream.finalMessage();
  const textBlock = finalMessage.content.find((b) => b.type === 'text') as
    | { type: 'text'; text: string }
    | undefined;
  return textBlock?.text ?? '';
}

export function isMissingApiKey(err: unknown): boolean {
  return err instanceof Anthropic.AuthenticationError;
}

// Convenience — a redaction helper any log site can use on config-like data.
export function redactApiKey(value: string | null | undefined): string {
  if (!value) return '<unset>';
  if (value.length < 8) return '<redacted>';
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

// Ensure the project directory exists before canvas/conversation writes — the
// callers assume it does. Exposed for tests.
export function ensureProjectDir(projectId: string): void {
  fs.mkdirSync(path.join(PROJECTS_DIR, projectId), { recursive: true });
}
