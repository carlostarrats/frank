// ai-routing.js — Format curated feedback as AI instruction, copy to clipboard
import sync from '../core/sync.js';
import projectManager from '../core/project.js';

export function setupAiRouting() {
  window.addEventListener('frank:open-ai-routing', (e) => {
    const { commentIds, comments, combined } = e.detail;
    showAiRoutingModal(commentIds, comments, combined);
  });
}

function showAiRoutingModal(commentIds, comments, combined) {
  // Remove existing modal
  document.querySelector('.ai-routing-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'ai-routing-modal';
  modal.innerHTML = `
    <div class="ai-routing-overlay" id="ai-close-overlay"></div>
    <div class="ai-routing-dialog">
      <h3>Copy for AI</h3>
      <div class="ai-routing-context">
        <div class="ai-routing-label">Reviewer feedback (${comments.length} comments)</div>
        <div class="ai-routing-feedback">
          ${comments.map(c => `
            <div class="ai-routing-comment">
              <strong>${esc(c.author)}:</strong> ${esc(c.text)}
              ${c.anchor?.cssSelector ? `<span class="ai-routing-anchor">${esc(c.anchor.cssSelector)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="ai-routing-instruction">
        <div class="ai-routing-label">Your instruction to the AI (edit freely)</div>
        <textarea class="input ai-routing-textarea" id="ai-instruction" rows="5">${esc(combined)}</textarea>
      </div>
      <div class="ai-routing-actions">
        <button class="btn-ghost" id="ai-cancel">Cancel</button>
        <button class="btn-primary" id="ai-copy">Copy for AI</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('ai-close-overlay').addEventListener('click', () => modal.remove());
  document.getElementById('ai-cancel').addEventListener('click', () => modal.remove());

  document.getElementById('ai-copy').addEventListener('click', async () => {
    const instruction = document.getElementById('ai-instruction').value.trim();
    if (!instruction) return;

    // Format structured prompt
    const prompt = formatAiPrompt(comments, instruction);

    // Copy to clipboard
    await navigator.clipboard.writeText(prompt);

    // Log the instruction
    const curationIds = []; // Would need to look up curations for these comments
    await sync.logAiInstruction(commentIds, curationIds, instruction);

    // Visual feedback
    document.getElementById('ai-copy').textContent = 'Copied!';
    setTimeout(() => modal.remove(), 1000);
  });
}

function formatAiPrompt(comments, instruction) {
  const lines = [
    '## Feedback from reviewers',
    '',
  ];

  for (const c of comments) {
    lines.push(`**${c.author}** ${c.anchor?.cssSelector ? `(on \`${c.anchor.cssSelector}\`)` : ''}:`);
    lines.push(`> ${c.text}`);
    lines.push('');
  }

  lines.push('## My instruction');
  lines.push('');
  lines.push(instruction);

  return lines.join('\n');
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
