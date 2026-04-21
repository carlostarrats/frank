// bundle.ts — "Download bundle": one zip containing everything an AI or
// reviewer needs to understand a project in isolation. Produced on demand
// by the daemon and streamed back to the UI as a base64 payload over the
// existing WebSocket, which then triggers a browser download.
//
// Contents (all optional except project.json + report.*):
//   project.json              — same shape as exportProject()
//   report.md + report.pdf    — stakeholder-facing narrative
//   canvas-state.json         — for canvas projects
//   canvas-thumbnail.png      — most recent thumbnail, if present
//   snapshots/{id}/…          — full snapshot folders (html, screenshot, thumb)
//   source/{filename}         — the original uploaded PDF/image, if any
//   assets/…                  — content-addressed canvas image drops
//
// Missing pieces are silently skipped; a bundle against a fresh project
// is tiny but still readable.

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { FRANK_DIR, PROJECTS_DIR } from './protocol.js';
import { loadProject } from './projects.js';
import { exportProject } from './export.js';
import { buildReportData, renderReportMarkdown, renderReportPdf } from './report.js';

export async function buildBundle(projectId: string): Promise<{ buffer: Buffer; filename: string }> {
  const project = loadProject(projectId);
  const zip = new JSZip();

  // 1. JSON export
  const jsonData = exportProject(projectId);
  zip.file('project.json', JSON.stringify(jsonData, null, 2));

  // 2. Markdown + PDF reports (shared ReportData so they never diverge).
  const reportData = buildReportData(projectId);
  zip.file('report.md', renderReportMarkdown(reportData));
  try {
    const pdfBuf = await renderReportPdf(reportData);
    zip.file('report.pdf', pdfBuf);
  } catch (e) {
    // PDF generation can fail on exotic data; keep the bundle producible.
    zip.file('report.pdf.error.txt', `PDF generation failed: ${String((e as Error).message || e)}`);
  }

  // 3. Canvas state (canvas projects only).
  const canvasStatePath = path.join(PROJECTS_DIR, projectId, 'canvas-state.json');
  if (fs.existsSync(canvasStatePath)) {
    zip.file('canvas-state.json', fs.readFileSync(canvasStatePath));
  }

  // 4. Snapshot folders — preserve structure so metadata pairs with content.
  const snapshotsDir = path.join(PROJECTS_DIR, projectId, 'snapshots');
  if (fs.existsSync(snapshotsDir)) {
    for (const entry of fs.readdirSync(snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const snapDir = path.join(snapshotsDir, entry.name);
      for (const f of fs.readdirSync(snapDir)) {
        const filePath = path.join(snapDir, f);
        if (!fs.statSync(filePath).isFile()) continue;
        zip.file(`snapshots/${entry.name}/${f}`, fs.readFileSync(filePath));
      }
    }
  }

  // 5. Source file for PDF/image projects.
  if (project.file) {
    const sourceFile = path.join(FRANK_DIR, project.file);
    if (fs.existsSync(sourceFile)) {
      zip.file(`source/${path.basename(sourceFile)}`, fs.readFileSync(sourceFile));
    }
  }

  // 6. Canvas assets (content-addressed image drops).
  const assetsDir = path.join(PROJECTS_DIR, projectId, 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const f of fs.readdirSync(assetsDir)) {
      const filePath = path.join(assetsDir, f);
      if (!fs.statSync(filePath).isFile()) continue;
      zip.file(`assets/${f}`, fs.readFileSync(filePath));
    }
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeName = (project.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
  return { buffer, filename: `${safeName}-bundle.zip` };
}
