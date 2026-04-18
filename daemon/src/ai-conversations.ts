// AI conversation storage. One JSON file per conversation at
//   ~/.frank/projects/{projectId}/ai-conversations/{conversationId}.json
//
// Conversations grow by appending messages. Size is the real cost concern, not
// message count — 50 short messages and 50 long streamed responses are orders
// of magnitude apart. We track both and gate on whichever hits first:
//   soft warn  at softWarnBytes / softWarnMessages  (UI shows a nudge)
//   hard cap   at hardCapBytes / hardCapMessages    (daemon refuses appends)
// When a hard cap is reached, the UI forces a new conversation that can
// reference the prior one via `continuedFrom` for continuity display.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';
import { getAiConversationLimits } from './cloud.js';

export type Role = 'user' | 'assistant';

export interface ConversationMessage {
  role: Role;
  content: string;
  ts: string;
}

export interface Conversation {
  id: string;
  title: string;
  created: string;
  modified: string;
  model: string;
  provider: string;
  continuedFrom: string | null;
  capReached: boolean;
  messages: ConversationMessage[];
}

export interface CapStatus {
  softWarn: boolean;
  hardCap: boolean;
  bytes: number;
  messageCount: number;
}

export class ConversationFullError extends Error {
  constructor(public reason: 'bytes' | 'messages') {
    super(`Conversation hit hard cap (${reason})`);
    this.name = 'ConversationFullError';
  }
}

function conversationsDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'ai-conversations');
}

function conversationPath(projectId: string, conversationId: string): string {
  return path.join(conversationsDir(projectId), conversationId + '.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function serialize(conversation: Conversation): string {
  return JSON.stringify(conversation, null, 2);
}

function writeConversation(projectId: string, conversation: Conversation): void {
  fs.mkdirSync(conversationsDir(projectId), { recursive: true });
  atomicWrite(conversationPath(projectId, conversation.id), serialize(conversation));
}

export function capStatusOf(conversation: Conversation): CapStatus {
  const limits = getAiConversationLimits();
  const bytes = Buffer.byteLength(serialize(conversation), 'utf8');
  const messageCount = conversation.messages.length;
  return {
    softWarn: bytes >= limits.softWarnBytes || messageCount >= limits.softWarnMessages,
    hardCap: bytes >= limits.hardCapBytes || messageCount >= limits.hardCapMessages,
    bytes,
    messageCount,
  };
}

export function createConversation(
  projectId: string,
  options: { model: string; provider: string; title?: string; continuedFrom?: string | null } = {
    model: 'claude-opus-4-7',
    provider: 'claude',
  },
): Conversation {
  const id = 'conv-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id,
    title: options.title || 'New conversation',
    created: now,
    modified: now,
    model: options.model,
    provider: options.provider,
    continuedFrom: options.continuedFrom ?? null,
    capReached: false,
    messages: [],
  };
  writeConversation(projectId, conversation);
  return conversation;
}

export function loadConversation(projectId: string, conversationId: string): Conversation | null {
  const p = conversationPath(projectId, conversationId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Conversation;
  } catch {
    return null;
  }
}

export function appendMessage(
  projectId: string,
  conversationId: string,
  role: Role,
  content: string,
): { conversation: Conversation; capStatus: CapStatus } {
  const conversation = loadConversation(projectId, conversationId);
  if (!conversation) throw new Error(`Conversation not found: ${conversationId}`);
  if (conversation.capReached) throw new ConversationFullError('bytes');

  // Generate a title from the first user message if still on the default
  if (role === 'user' && conversation.title === 'New conversation') {
    conversation.title = content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'New conversation';
  }

  conversation.messages.push({ role, content, ts: new Date().toISOString() });
  conversation.modified = new Date().toISOString();

  const status = capStatusOf(conversation);
  if (status.hardCap) {
    conversation.capReached = true;
    writeConversation(projectId, conversation);
    throw new ConversationFullError(
      status.bytes >= getAiConversationLimits().hardCapBytes ? 'bytes' : 'messages',
    );
  }

  writeConversation(projectId, conversation);
  return { conversation, capStatus: status };
}

export function listConversations(projectId: string): Array<{
  id: string;
  title: string;
  modified: string;
  messageCount: number;
  bytes: number;
  model: string;
  continuedFrom: string | null;
  capReached: boolean;
}> {
  const dir = conversationsDir(projectId);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir);
  const summaries: Array<{
    id: string;
    title: string;
    modified: string;
    messageCount: number;
    bytes: number;
    model: string;
    continuedFrom: string | null;
    capReached: boolean;
  }> = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const p = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const conversation = JSON.parse(raw) as Conversation;
      summaries.push({
        id: conversation.id,
        title: conversation.title,
        modified: conversation.modified,
        messageCount: conversation.messages.length,
        bytes: Buffer.byteLength(raw, 'utf8'),
        model: conversation.model,
        continuedFrom: conversation.continuedFrom,
        capReached: !!conversation.capReached,
      });
    } catch { /* skip corrupt */ }
  }

  return summaries.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function deleteConversation(projectId: string, conversationId: string): boolean {
  const p = conversationPath(projectId, conversationId);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}
