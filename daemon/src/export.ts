import { PROJECTS_DIR } from './protocol.js';
import { loadProject, loadComments } from './projects.js';
import { listSnapshots } from './snapshots.js';
import { loadCurations } from './curation.js';
import { loadAiChain } from './ai-chain.js';

export interface FrankExport {
  frank_export_version: '1';
  exportedAt: string;
  project: {
    name: string;
    url?: string;
    file?: string;
    contentType: string;
    created: string;
    screens: Array<{ id: string; route: string; label: string }>;
  };
  snapshots: Array<{
    id: string;
    trigger: string;
    triggeredBy: string | null;
    starred: boolean;
    label: string;
    ts: string;
  }>;
  comments: Array<{
    id: string;
    author: string;
    screenId: string;
    anchor: unknown;
    text: string;
    status: string;
    ts: string;
  }>;
  curations: Array<{
    id: string;
    commentIds: string[];
    action: string;
    originalTexts: string[];
    remixedText: string;
    ts: string;
  }>;
  aiInstructions: Array<{
    id: string;
    curationIds: string[];
    instruction: string;
    resultSnapshot: string | null;
    ts: string;
  }>;
  timeline: Array<{
    type: string;
    id: string;
    ts: string;
    [key: string]: unknown;
  }>;
}

export function exportProject(projectId: string): FrankExport {
  const project = loadProject(projectId);
  const comments = loadComments(projectId);
  const snapshots = listSnapshots(projectId);
  const curations = loadCurations(projectId);
  const aiChain = loadAiChain(projectId);

  // Build unified timeline
  const timeline: FrankExport['timeline'] = [];

  for (const c of comments) {
    timeline.push({ type: 'comment', id: c.id, ts: c.ts, author: c.author, screenId: c.screenId });
  }
  for (const cur of curations) {
    timeline.push({ type: 'curation', id: cur.id, ts: cur.ts, action: cur.action });
  }
  for (const ai of aiChain) {
    timeline.push({ type: 'ai_instruction', id: ai.id, ts: ai.ts });
  }
  for (const snap of snapshots) {
    timeline.push({ type: 'snapshot', id: snap.id, ts: snap.ts, trigger: snap.trigger, triggeredBy: snap.triggeredBy });
  }

  timeline.sort((a, b) => a.ts.localeCompare(b.ts));

  const screens = Object.entries(project.screens).map(([id, s]) => ({
    id,
    route: s.route,
    label: s.label,
  }));

  return {
    frank_export_version: '1',
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      url: project.url,
      file: project.file,
      contentType: project.contentType,
      created: project.created,
      screens,
    },
    snapshots: snapshots.map(s => ({
      id: s.id,
      trigger: s.trigger,
      triggeredBy: s.triggeredBy,
      starred: s.starred,
      label: s.label,
      ts: s.ts,
    })),
    comments: comments.map(c => ({
      id: c.id,
      author: c.author,
      screenId: c.screenId,
      anchor: c.anchor,
      text: c.text,
      status: c.status,
      ts: c.ts,
    })),
    curations: curations.map(cur => ({
      id: cur.id,
      commentIds: cur.commentIds,
      action: cur.action,
      originalTexts: cur.originalTexts,
      remixedText: cur.remixedText,
      ts: cur.ts,
    })),
    aiInstructions: aiChain.map(ai => ({
      id: ai.id,
      curationIds: ai.curationIds,
      instruction: ai.instruction,
      resultSnapshot: ai.resultSnapshot,
      ts: ai.ts,
    })),
    timeline,
  };
}
