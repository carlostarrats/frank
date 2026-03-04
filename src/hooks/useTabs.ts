import { useState, useCallback } from 'react';
import type { LookyLooSchema, Platform } from '../schema/types';

export interface Tab {
  id: string;
  label: string;
  timestamp: string;
  platform: Platform;
  status: 'loading' | 'complete';
  schema: LookyLooSchema | null; // null only when status === 'loading'
  flashKey: number; // incremented when tab updates in place — triggers label flash
}

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Add or update a tab. If a complete tab with the same label exists, update it in place.
  const addTab = useCallback((schema: LookyLooSchema): string => {
    let resolvedId = '';

    setTabs((prev) => {
      const existing = prev.find(
        (t) => t.label === schema.label && t.status === 'complete'
      );
      if (existing) {
        resolvedId = existing.id;
        return prev.map((t) =>
          t.id === existing.id
            ? {
                ...t,
                schema,
                timestamp: schema.timestamp,
                platform: schema.platform,
                flashKey: t.flashKey + 1,
              }
            : t
        );
      }
      resolvedId = crypto.randomUUID();
      return [
        ...prev,
        {
          id: resolvedId,
          label: schema.label,
          timestamp: schema.timestamp,
          platform: schema.platform,
          status: 'complete',
          schema,
          flashKey: 0,
        },
      ];
    });

    setActiveTabId(resolvedId);
    return resolvedId;
  }, []);

  // Add a placeholder tab before its schema arrives (used by multi-screen flows).
  const addLoadingTab = useCallback((label: string, platform: Platform): string => {
    const id = crypto.randomUUID();
    setTabs((prev) => [
      ...prev,
      {
        id,
        label,
        timestamp: new Date().toISOString(),
        platform,
        status: 'loading',
        schema: null,
        flashKey: 0,
      },
    ]);
    setActiveTabId(id);
    return id;
  }, []);

  // Resolve a loading tab with its completed schema.
  const resolveTab = useCallback((id: string, schema: LookyLooSchema) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              label: schema.label,
              timestamp: schema.timestamp,
              platform: schema.platform,
              status: 'complete' as const,
              schema,
            }
          : t
      )
    );
  }, []);

  // Close a single tab. If it was active, switch to the nearest adjacent tab.
  const closeTab = useCallback(
    (id: string) => {
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);
      setTabs(remaining);
      if (activeTabId === id) {
        if (remaining.length === 0) {
          setActiveTabId(null);
        } else {
          const newIdx = Math.min(idx, remaining.length - 1);
          setActiveTabId(remaining[newIdx]?.id ?? null);
        }
      }
    },
    [tabs, activeTabId]
  );

  const clearTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return {
    tabs,
    activeTab,
    activeTabId,
    setActiveTabId,
    addTab,
    addLoadingTab,
    resolveTab,
    closeTab,
    clearTabs,
  };
}
