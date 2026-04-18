import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
let mockLimits = {
  softWarnBytes: 2 * 1024 * 1024,
  hardCapBytes: 5 * 1024 * 1024,
  softWarnMessages: 100,
  hardCapMessages: 200,
};

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return tmpDir; },
  };
});

vi.mock('./cloud.js', () => ({
  getAiConversationLimits: () => mockLimits,
}));

import {
  createConversation,
  loadConversation,
  appendMessage,
  listConversations,
  deleteConversation,
  capStatusOf,
  ConversationFullError,
} from './ai-conversations.js';

function setupProject(projectId: string) {
  fs.mkdirSync(path.join(tmpDir, projectId), { recursive: true });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-ai-conv-'));
  mockLimits = {
    softWarnBytes: 2 * 1024 * 1024,
    hardCapBytes: 5 * 1024 * 1024,
    softWarnMessages: 100,
    hardCapMessages: 200,
  };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createConversation', () => {
  it('creates a conversation file under ai-conversations/', () => {
    setupProject('proj-1');
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    expect(conv.id).toMatch(/^conv-\d+-[a-f0-9]{6}$/);
    expect(conv.messages).toEqual([]);
    expect(conv.capReached).toBe(false);
    expect(conv.continuedFrom).toBeNull();
    const filePath = path.join(tmpDir, 'proj-1', 'ai-conversations', conv.id + '.json');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('records continuedFrom when provided', () => {
    setupProject('proj-2');
    const conv = createConversation('proj-2', { model: 'claude-opus-4-7', provider: 'claude', continuedFrom: 'conv-old' });
    expect(conv.continuedFrom).toBe('conv-old');
  });
});

describe('appendMessage', () => {
  it('appends user and assistant turns and updates modified', async () => {
    setupProject('proj-1');
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    const { conversation: c1 } = appendMessage('proj-1', conv.id, 'user', 'hello');
    expect(c1.messages).toHaveLength(1);
    expect(c1.messages[0].role).toBe('user');
    expect(c1.messages[0].content).toBe('hello');

    await new Promise((r) => setTimeout(r, 5));
    const { conversation: c2 } = appendMessage('proj-1', conv.id, 'assistant', 'hi!');
    expect(c2.messages).toHaveLength(2);
    expect(c2.messages[1].role).toBe('assistant');
    expect(c2.modified > c1.modified).toBe(true);
  });

  it('derives title from the first user message', () => {
    setupProject('proj-1');
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    const { conversation: c1 } = appendMessage('proj-1', conv.id, 'user', 'Help me design a login flow');
    expect(c1.title).toBe('Help me design a login flow');
  });

  it('raises ConversationFullError when the message count hard cap is reached', () => {
    setupProject('proj-1');
    mockLimits.hardCapMessages = 3;
    mockLimits.softWarnMessages = 2;
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    appendMessage('proj-1', conv.id, 'user', 'one');
    appendMessage('proj-1', conv.id, 'assistant', 'two');
    expect(() => appendMessage('proj-1', conv.id, 'user', 'three')).toThrow(ConversationFullError);

    const reloaded = loadConversation('proj-1', conv.id)!;
    expect(reloaded.capReached).toBe(true);
    expect(reloaded.messages).toHaveLength(3);
  });

  it('raises ConversationFullError when the byte hard cap is reached', () => {
    setupProject('proj-1');
    mockLimits.hardCapBytes = 500;
    mockLimits.softWarnBytes = 200;
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    const big = 'x'.repeat(600);
    expect(() => appendMessage('proj-1', conv.id, 'user', big)).toThrow(ConversationFullError);
  });

  it('refuses to append to a capped conversation', () => {
    setupProject('proj-1');
    mockLimits.hardCapMessages = 1;
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    expect(() => appendMessage('proj-1', conv.id, 'user', 'one')).toThrow(ConversationFullError);
    // After cap is raised, reloading shows capReached=true, further appends refused
    expect(() => appendMessage('proj-1', conv.id, 'user', 'two')).toThrow(ConversationFullError);
  });
});

describe('capStatusOf', () => {
  it('flags softWarn before hardCap', () => {
    setupProject('proj-1');
    mockLimits.softWarnMessages = 2;
    mockLimits.hardCapMessages = 10;
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    appendMessage('proj-1', conv.id, 'user', 'one');
    const { conversation } = appendMessage('proj-1', conv.id, 'assistant', 'two');
    const status = capStatusOf(conversation);
    expect(status.softWarn).toBe(true);
    expect(status.hardCap).toBe(false);
  });
});

describe('listConversations', () => {
  it('returns empty when directory is absent', () => {
    setupProject('empty');
    expect(listConversations('empty')).toEqual([]);
  });

  it('sorts by modified descending', async () => {
    setupProject('proj-1');
    const a = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    await new Promise((r) => setTimeout(r, 5));
    const b = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    const summaries = listConversations('proj-1');
    expect(summaries.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('includes byte and message counts', () => {
    setupProject('proj-1');
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    appendMessage('proj-1', conv.id, 'user', 'hi');
    const [summary] = listConversations('proj-1');
    expect(summary.id).toBe(conv.id);
    expect(summary.messageCount).toBe(1);
    expect(summary.bytes).toBeGreaterThan(0);
  });
});

describe('deleteConversation', () => {
  it('removes the file', () => {
    setupProject('proj-1');
    const conv = createConversation('proj-1', { model: 'claude-opus-4-7', provider: 'claude' });
    expect(deleteConversation('proj-1', conv.id)).toBe(true);
    expect(loadConversation('proj-1', conv.id)).toBeNull();
  });

  it('returns false when the conversation does not exist', () => {
    setupProject('proj-1');
    expect(deleteConversation('proj-1', 'conv-missing')).toBe(false);
  });
});
