// Detects which Claude Code plugins the user has installed.
// Reads ~/.claude/plugins/installed_plugins.json via a Tauri invoke command.
// Returns a Set of recognized plugin names (figma, github, etc.).
// Fails silently — if the file is missing or unreadable, returns an empty Set.

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const KNOWN_PLUGINS = ['figma', 'github'] as const;
export type KnownPlugin = (typeof KNOWN_PLUGINS)[number];

interface PluginsFile {
  plugins: Record<string, unknown>;
}

export function useInstalledPlugins(): Set<KnownPlugin> {
  const [plugins, setPlugins] = useState(new Set<KnownPlugin>());

  useEffect(() => {
    invoke<string>('read_installed_plugins')
      .then(json => {
        const data = JSON.parse(json) as PluginsFile;
        const found = new Set<KnownPlugin>();
        for (const key of Object.keys(data.plugins ?? {})) {
          const name = key.split('@')[0] as KnownPlugin;
          if ((KNOWN_PLUGINS as readonly string[]).includes(name)) {
            found.add(name);
          }
        }
        setPlugins(found);
      })
      .catch(() => {});
  }, []);

  return plugins;
}
