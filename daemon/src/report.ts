// report.ts — Project report export (Markdown + PDF).
//
// Assembles a stakeholder-facing narrative from the raw project data:
// comments with timestamps, curation decisions, snapshots, AI-routing log.
// Structured as three tiers:
//   1. buildReportData()     — pure data assembly (exported, testable)
//   2. renderReportMarkdown()— data → GitHub-flavored markdown string
//   3. renderReportPdf()     — data → Buffer via pdfmake
//
// pdfmake is synchronous-looking but uses callbacks under the hood; we wrap
// the getBuffer call in a Promise. The library is bundled at build time via
// the daemon's npm deps (see package.json).

import type { FrankExport } from './export.js';
import { exportProject } from './export.js';
import { loadProject, loadComments } from './projects.js';
import { listSnapshots } from './snapshots.js';
import { loadCurations } from './curation.js';
import { loadAiChain } from './ai-chain.js';
import { listConversations } from './ai-conversations.js';

export interface ReportData {
  project: FrankExport['project'];
  exportedAt: string;
  summary: {
    totalComments: number;
    approvedComments: number;
    dismissedComments: number;
    remixedComments: number;
    snapshots: number;
    aiInstructions: number;
    conversations: number;
  };
  comments: Array<{ id: string; author: string; text: string; status: string; ts: string }>;
  curations: Array<{ id: string; action: string; originalTexts: string[]; remixedText: string; ts: string }>;
  snapshots: Array<{ id: string; label: string; starred: boolean; trigger: string; ts: string }>;
  aiInstructions: Array<{ id: string; instruction: string; ts: string }>;
  conversations: Array<{ id: string; title: string; messageCount: number; modified: string }>;
}

export function buildReportData(projectId: string): ReportData {
  const project = loadProject(projectId);
  const comments = loadComments(projectId);
  const curations = loadCurations(projectId);
  const aiChain = loadAiChain(projectId);
  const snapshots = listSnapshots(projectId);
  const conversations = listConversations(projectId);

  const summary = {
    totalComments: comments.length,
    approvedComments: comments.filter(c => c.status === 'approved').length,
    dismissedComments: comments.filter(c => c.status === 'dismissed').length,
    remixedComments: comments.filter(c => c.status === 'remixed').length,
    snapshots: snapshots.length,
    aiInstructions: aiChain.length,
    conversations: conversations.length,
  };

  const screens = Object.entries(project.screens).map(([id, s]) => ({ id, route: s.route, label: s.label }));

  return {
    project: {
      name: project.name,
      url: project.url,
      file: project.file,
      contentType: project.contentType,
      created: project.created,
      screens,
      ...(project.intent ? { intent: project.intent } : {}),
    },
    exportedAt: new Date().toISOString(),
    summary,
    comments: comments.map(c => ({ id: c.id, author: c.author, text: c.text, status: c.status, ts: c.ts })),
    curations: curations.map(cur => ({ id: cur.id, action: cur.action, originalTexts: cur.originalTexts, remixedText: cur.remixedText, ts: cur.ts })),
    snapshots: snapshots.map(s => ({ id: s.id, label: s.label, starred: s.starred, trigger: s.trigger, ts: s.ts })),
    aiInstructions: aiChain.map(ai => ({ id: ai.id, instruction: ai.instruction, ts: ai.ts })),
    conversations: conversations.map(c => ({ id: c.id, title: c.title, messageCount: c.messageCount, modified: c.modified })),
  };
}

// ─── Markdown renderer ──────────────────────────────────────────────────────

export function renderReportMarkdown(data: ReportData): string {
  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const lines: string[] = [];
  lines.push(`# ${data.project.name}`);
  lines.push('');
  lines.push(`**Type:** ${data.project.contentType}`);
  if (data.project.url) lines.push(`**URL:** ${data.project.url}`);
  if (data.project.file) lines.push(`**File:** ${data.project.file}`);
  lines.push(`**Created:** ${fmtDate(data.project.created)}`);
  lines.push(`**Report generated:** ${fmtDate(data.exportedAt)}`);
  lines.push('');

  if (data.project.intent) {
    lines.push('## Project brief');
    lines.push('');
    lines.push(data.project.intent);
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total comments: **${data.summary.totalComments}** (${data.summary.approvedComments} approved · ${data.summary.dismissedComments} dismissed · ${data.summary.remixedComments} remixed)`);
  lines.push(`- Snapshots: **${data.summary.snapshots}**`);
  lines.push(`- AI instructions routed: **${data.summary.aiInstructions}**`);
  lines.push(`- AI conversations: **${data.summary.conversations}**`);
  lines.push('');

  if (data.comments.length > 0) {
    lines.push('## Comments');
    lines.push('');
    for (const c of data.comments) {
      lines.push(`### ${c.author} — *${c.status}* — ${fmtDate(c.ts)}`);
      lines.push('');
      lines.push(c.text);
      lines.push('');
    }
  }

  if (data.curations.length > 0) {
    lines.push('## Decisions');
    lines.push('');
    for (const cur of data.curations) {
      lines.push(`### ${cur.action.toUpperCase()} — ${fmtDate(cur.ts)}`);
      lines.push('');
      if (cur.originalTexts.length > 0) {
        lines.push('**Original feedback:**');
        lines.push('');
        for (const t of cur.originalTexts) lines.push(`> ${t}`);
        lines.push('');
      }
      if (cur.remixedText) {
        lines.push(`**Remixed:** ${cur.remixedText}`);
        lines.push('');
      }
    }
  }

  if (data.snapshots.length > 0) {
    lines.push('## Snapshots');
    lines.push('');
    lines.push('| Date | Trigger | Label |');
    lines.push('|------|---------|-------|');
    for (const s of data.snapshots) {
      const label = (s.starred ? '⭐ ' : '') + (s.label || '—');
      lines.push(`| ${fmtDate(s.ts)} | ${s.trigger} | ${label} |`);
    }
    lines.push('');
  }

  if (data.aiInstructions.length > 0) {
    lines.push('## AI instructions');
    lines.push('');
    for (const ai of data.aiInstructions) {
      lines.push(`### ${fmtDate(ai.ts)}`);
      lines.push('');
      lines.push(ai.instruction);
      lines.push('');
    }
  }

  if (data.conversations.length > 0) {
    lines.push('## AI conversations');
    lines.push('');
    for (const conv of data.conversations) {
      lines.push(`- **${conv.title}** — ${conv.messageCount} messages — last active ${fmtDate(conv.modified)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── PDF renderer (pdfmake) ─────────────────────────────────────────────────
//
// pdfmake takes a declarative document definition object and produces a
// Buffer. We build the same sections as the markdown renderer, keyed off
// the shared ReportData so the two never diverge on content.

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  // pdfmake's Node entry point. The `build/pdfmake.js` bundle is the browser
  // build and hangs without the VFS fonts loaded — use the js/index.js entry
  // and point Roboto at the real TTF files shipped in build/fonts/Roboto.
  const pdfMakeMod = await import('pdfmake');
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod;

  // Locate the Roboto fonts relative to this module (node_modules/pdfmake).
  // Use createRequire so resolution works from ESM.
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const pdfmakePkgJson = require.resolve('pdfmake/package.json');
  const pdfmakeDir = pdfmakePkgJson.replace(/\/package\.json$/, '');
  const fontsDir = `${pdfmakeDir}/build/fonts/Roboto`;

  pdfMake.fonts = {
    Roboto: {
      normal:      `${fontsDir}/Roboto-Regular.ttf`,
      bold:        `${fontsDir}/Roboto-Medium.ttf`,
      italics:     `${fontsDir}/Roboto-Italic.ttf`,
      bolditalics: `${fontsDir}/Roboto-MediumItalic.ttf`,
    },
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const content: any[] = [];
  content.push({ text: data.project.name, style: 'h1' });
  const metaLines: any[] = [
    `Type: ${data.project.contentType}`,
  ];
  if (data.project.url) metaLines.push(`URL: ${data.project.url}`);
  if (data.project.file) metaLines.push(`File: ${data.project.file}`);
  metaLines.push(`Created: ${fmtDate(data.project.created)}`);
  metaLines.push(`Report generated: ${fmtDate(data.exportedAt)}`);
  content.push({ text: metaLines.join('\n'), style: 'meta', margin: [0, 0, 0, 16] });

  if (data.project.intent) {
    content.push({ text: 'Project brief', style: 'h2' });
    content.push({ text: data.project.intent, margin: [0, 0, 0, 16] });
  }

  content.push({ text: 'Summary', style: 'h2' });
  content.push({
    ul: [
      `Total comments: ${data.summary.totalComments} (${data.summary.approvedComments} approved · ${data.summary.dismissedComments} dismissed · ${data.summary.remixedComments} remixed)`,
      `Snapshots: ${data.summary.snapshots}`,
      `AI instructions routed: ${data.summary.aiInstructions}`,
      `AI conversations: ${data.summary.conversations}`,
    ],
    margin: [0, 0, 0, 16],
  });

  if (data.comments.length > 0) {
    content.push({ text: 'Comments', style: 'h2' });
    for (const c of data.comments) {
      content.push({ text: `${c.author} — ${c.status} — ${fmtDate(c.ts)}`, style: 'h3' });
      content.push({ text: c.text, margin: [0, 0, 0, 8] });
    }
  }

  if (data.curations.length > 0) {
    content.push({ text: 'Decisions', style: 'h2' });
    for (const cur of data.curations) {
      content.push({ text: `${cur.action.toUpperCase()} — ${fmtDate(cur.ts)}`, style: 'h3' });
      if (cur.originalTexts.length > 0) {
        content.push({ text: 'Original feedback:', bold: true });
        for (const t of cur.originalTexts) content.push({ text: t, italics: true, margin: [12, 0, 0, 4] });
      }
      if (cur.remixedText) content.push({ text: `Remixed: ${cur.remixedText}`, margin: [0, 4, 0, 8] });
    }
  }

  if (data.snapshots.length > 0) {
    content.push({ text: 'Snapshots', style: 'h2' });
    const tableBody: any[] = [
      [{ text: 'Date', bold: true }, { text: 'Trigger', bold: true }, { text: 'Label', bold: true }],
      ...data.snapshots.map(s => [
        fmtDate(s.ts),
        s.trigger,
        (s.starred ? '⭐ ' : '') + (s.label || '—'),
      ]),
    ];
    content.push({ table: { widths: ['*', 'auto', '*'], body: tableBody }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 16] });
  }

  if (data.aiInstructions.length > 0) {
    content.push({ text: 'AI instructions', style: 'h2' });
    for (const ai of data.aiInstructions) {
      content.push({ text: fmtDate(ai.ts), style: 'h3' });
      content.push({ text: ai.instruction, margin: [0, 0, 0, 8] });
    }
  }

  if (data.conversations.length > 0) {
    content.push({ text: 'AI conversations', style: 'h2' });
    content.push({
      ul: data.conversations.map(conv => `${conv.title} — ${conv.messageCount} messages — last active ${fmtDate(conv.modified)}`),
    });
  }

  const docDef: any = {
    content,
    styles: {
      h1: { fontSize: 22, bold: true, margin: [0, 0, 0, 8] },
      h2: { fontSize: 16, bold: true, margin: [0, 12, 0, 6] },
      h3: { fontSize: 12, bold: true, margin: [0, 6, 0, 2] },
      meta: { fontSize: 10, color: '#666' },
    },
    defaultStyle: { fontSize: 11 },
    pageMargins: [48, 48, 48, 48],
  };

  // pdfmake/js returns an OutputDocumentServer whose getBuffer() is a Promise.
  const doc = pdfMake.createPdf(docDef);
  const buf: Buffer = await doc.getBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

// Convenience: one-shot export for a given project + format.
export async function exportReport(projectId: string, format: 'markdown' | 'pdf'): Promise<{ mimeType: string; data: string }> {
  const _ = exportProject; // keep the import hot so build order is stable
  void _;
  const report = buildReportData(projectId);
  if (format === 'markdown') {
    return { mimeType: 'text/markdown', data: renderReportMarkdown(report) };
  }
  const buf = await renderReportPdf(report);
  return { mimeType: 'application/pdf', data: buf.toString('base64') };
}
