// Figma export — copies a prompt designed to be used directly in Claude Code
// with the Figma MCP plugin. The schema provides full structural intent;
// Claude + Figma MCP translates it into frames and auto-layout components.

import type { LookyLooSchema } from '../schema/types';

export async function copyAsFigmaPrompt(schema: LookyLooSchema): Promise<void> {
  const json = JSON.stringify(schema, null, 2);
  const prompt =
    `Use the Figma MCP to create a wireframe design from this Looky Loo schema. ` +
    `For each section, create a Figma frame with auto-layout. ` +
    `Use placeholder fills, no real images or colors — low-fidelity wireframe style:\n\n` +
    `\`\`\`json\n${json}\n\`\`\``;
  await navigator.clipboard.writeText(prompt);
}
