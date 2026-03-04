import { useState, useCallback } from 'react';
import type { LookyLooSchema } from '../schema/types';

export interface Tab {
  id: string;
  label: string;
  timestamp: string;
  schema: LookyLooSchema;
}

export function useTabs() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const addTab = useCallback((schema: LookyLooSchema): string => {
    const id = crypto.randomUUID();
    const tab: Tab = {
      id,
      label: schema.label,
      timestamp: schema.timestamp,
      schema,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(id);
    return id;
  }, []);

  const clearTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  return { tabs, activeTab, activeTabId, setActiveTabId, addTab, clearTabs };
}
