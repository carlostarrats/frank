// snapshot.js — Captures DOM from iframe, inlines styles for sharing

export async function captureSnapshot(iframeEl) {
  try {
    const doc = iframeEl.contentDocument;
    if (!doc) return null;

    // Clone the document
    const html = doc.documentElement.outerHTML;

    // Inline all stylesheets
    let inlinedHtml = html;
    const styles = [];
    for (const sheet of doc.styleSheets) {
      try {
        const rules = Array.from(sheet.cssRules).map(r => r.cssText).join('\n');
        styles.push(rules);
      } catch {
        // Cross-origin stylesheet — fetch it
        if (sheet.href) {
          try {
            const res = await fetch(sheet.href);
            styles.push(await res.text());
          } catch { /* skip unfetchable */ }
        }
      }
    }

    // Strip password field values
    const parser = new DOMParser();
    const clonedDoc = parser.parseFromString(inlinedHtml, 'text/html');
    clonedDoc.querySelectorAll('input[type="password"]').forEach(el => {
      el.setAttribute('value', '');
    });

    // Inject inlined styles
    const styleTag = clonedDoc.createElement('style');
    styleTag.textContent = styles.join('\n');
    clonedDoc.head.appendChild(styleTag);

    // Remove external stylesheet links (they won't work in the share)
    clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

    // Remove scripts (snapshot is static)
    clonedDoc.querySelectorAll('script').forEach(el => el.remove());

    const finalHtml = '<!DOCTYPE html>\n' + clonedDoc.documentElement.outerHTML;

    return {
      html: finalHtml,
      capturedAt: new Date().toISOString(),
      frankVersion: '2',
    };
  } catch (e) {
    console.error('[snapshot] capture failed:', e);
    return null;
  }
}

// Detect common sensitive patterns in HTML
export function detectSensitiveContent(html) {
  const warnings = [];

  // Email patterns
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = html.match(emailRegex);
  if (emails && emails.length > 0) {
    warnings.push(`${emails.length} email address(es) detected`);
  }

  // API key patterns
  const apiKeyPatterns = [
    /sk[-_][a-zA-Z0-9]{20,}/g,
    /api[-_]?key["\s:=]+["']?[a-zA-Z0-9]{16,}/gi,
    /bearer\s+[a-zA-Z0-9._-]{20,}/gi,
  ];
  for (const pattern of apiKeyPatterns) {
    if (pattern.test(html)) {
      warnings.push('Possible API key or token detected');
      break;
    }
  }

  // Password fields with values
  if (/type=["']password["'][^>]*value=["'][^"']+/i.test(html)) {
    warnings.push('Password field with value detected');
  }

  return warnings;
}

// Builds a share snapshot for image/PDF project types — fetches the source
// file from the daemon's /files/ route (same-origin, so this works) and
// inlines it as a data URL. Returns null on failure.
export async function buildMediaFileSnapshot(filePath) {
  try {
    const res = await fetch(`/files/${encodeURIComponent(filePath)}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || 'application/octet-stream';
    const fileDataUrl = await blobToDataUrl(blob);
    return {
      fileDataUrl,
      mimeType,
      capturedAt: new Date().toISOString(),
      frankVersion: '2',
    };
  } catch (e) {
    console.error('[snapshot] buildMediaFileSnapshot failed:', e);
    return null;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}
