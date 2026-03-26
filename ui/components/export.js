// export.js — Export wireframes as PNG or standalone HTML

import { renderScreen } from '../render/screen.js';

/**
 * Export the current screen as a PNG image.
 * Uses SVG foreignObject to render DOM content to a canvas.
 */
export async function exportScreenAsPng(screen, screenId) {
  const wireframeHtml = renderScreen(screen);

  // Collect all stylesheets
  const styles = await collectStyles();

  const deviceWidth = screen.viewport?.width || 1440;
  const deviceHeight = screen.viewport?.height || 900;

  // Build a self-contained HTML string
  const htmlContent = `
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${deviceWidth}px;">
      <style>${styles}</style>
      ${wireframeHtml}
    </div>
  `;

  // Create SVG foreignObject
  const svgData = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${deviceWidth}" height="${deviceHeight}">
      <foreignObject width="100%" height="100%">
        ${htmlContent}
      </foreignObject>
    </svg>
  `;

  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const scale = 2; // retina
    canvas.width = deviceWidth * scale;
    canvas.height = deviceHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${screenId || 'wireframe'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    }, 'image/png');
  };

  img.onerror = () => {
    // Fallback: open SVG in new tab
    URL.revokeObjectURL(url);
    console.warn('[export] PNG export failed, trying fallback...');
    exportScreenAsHtml(screen, screenId);
  };

  img.src = url;
}

/**
 * Export the current screen as a standalone HTML file.
 */
export async function exportScreenAsHtml(screen, screenId) {
  const wireframeHtml = renderScreen(screen);
  const styles = await collectStyles();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(screen.label || screenId || 'Wireframe')}</title>
  <style>
    body {
      margin: 0;
      padding: 40px;
      background: #1e1e1e;
      display: flex;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .wireframe {
      box-shadow: 0 0 0 1px rgba(255,255,255,0.06), 0 4px 24px rgba(0,0,0,0.4);
      border-radius: 8px;
      overflow: hidden;
    }
    ${styles}
  </style>
</head>
<body>
  ${wireframeHtml}
</body>
</html>`;

  downloadFile(html, `${screenId || 'wireframe'}.html`, 'text/html');
}

/**
 * Collect all stylesheets from the page into a single string.
 */
async function collectStyles() {
  const styleTexts = [];

  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules || sheet.rules;
      for (const rule of rules) {
        styleTexts.push(rule.cssText);
      }
    } catch (e) {
      // Cross-origin stylesheet — try fetching
      if (sheet.href) {
        try {
          const resp = await fetch(sheet.href);
          const text = await resp.text();
          styleTexts.push(text);
        } catch (fetchErr) {
          console.warn('[export] could not fetch stylesheet:', sheet.href);
        }
      }
    }
  }

  return styleTexts.join('\n');
}

/**
 * Trigger a file download.
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
