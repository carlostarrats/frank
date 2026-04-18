import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';

export interface AiInstruction {
  id: string;
  feedbackIds: string[];
  curationIds: string[];
  instruction: string;
  resultSnapshot: string | null;
  ts: string;
  // v2: in-app AI panel enrichments. All optional so v1 entries remain valid.
  provider?: string;
  modelId?: string;
  conversationId?: string;
  status?: 'pending' | 'streaming' | 'complete' | 'error';
}

function chainPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'ai-chain.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function loadAiChain(projectId: string): AiInstruction[] {
  const p = chainPath(projectId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

export function addAiInstruction(
  projectId: string,
  feedbackIds: string[],
  curationIds: string[],
  instruction: string
): AiInstruction {
  const chain = loadAiChain(projectId);
  const entry: AiInstruction = {
    id: 'ai-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    feedbackIds,
    curationIds,
    instruction,
    resultSnapshot: null,
    ts: new Date().toISOString(),
  };
  chain.push(entry);
  atomicWrite(chainPath(projectId), JSON.stringify(chain, null, 2));
  return entry;
}

export function linkSnapshotToInstruction(
  projectId: string,
  instructionId: string,
  snapshotId: string
): void {
  const chain = loadAiChain(projectId);
  const entry = chain.find(e => e.id === instructionId);
  if (entry) {
    entry.resultSnapshot = snapshotId;
    atomicWrite(chainPath(projectId), JSON.stringify(chain, null, 2));
  }
}
