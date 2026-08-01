'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// The same right panel serves two purposes: running a NEW ingestion (mode
// 'new', the original behavior) and reviewing how a PAST spec was ingested
// (mode 'history', driven by historySpec) — one component, one visual
// language, instead of a separate historical-replay page.
type PanelMode = 'new' | 'history';

interface PanelCtx {
  isOpen: boolean;
  mode: PanelMode;
  historySpec: string | null;
  open: () => void;
  close: () => void;
}

const Ctx = createContext<PanelCtx>({
  isOpen: false, mode: 'new', historySpec: null, open: () => {}, close: () => {},
});

export function PanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<PanelMode>('new');
  const [historySpec, setHistorySpec] = useState<string | null>(null);

  const open  = useCallback(() => { setMode('new'); setHistorySpec(null); setIsOpen(true); }, []);
  const close = useCallback(() => setIsOpen(false), []);

  // Allow any component to open the panel via DOM events (keeps callers from
  // needing to thread the panel context through every button that opens it)
  useEffect(() => {
    const onNew = () => { setMode('new'); setHistorySpec(null); setIsOpen(true); };
    const onHistory = (e: Event) => {
      const specName = (e as CustomEvent<string>).detail;
      setMode('history'); setHistorySpec(specName); setIsOpen(true);
    };
    window.addEventListener('open-agent-panel', onNew);
    window.addEventListener('open-agent-panel-history', onHistory as EventListener);
    return () => {
      window.removeEventListener('open-agent-panel', onNew);
      window.removeEventListener('open-agent-panel-history', onHistory as EventListener);
    };
  }, []);

  return <Ctx.Provider value={{ isOpen, mode, historySpec, open, close }}>{children}</Ctx.Provider>;
}

export const usePanelCtx = () => useContext(Ctx);

// Call this from anywhere to open the panel in "run a new ingestion" mode
export function openAgentPanel() {
  window.dispatchEvent(new Event('open-agent-panel'));
}

// Call this to open the panel showing how `specName` was ingested
export function openSpecHistory(specName: string) {
  window.dispatchEvent(new CustomEvent('open-agent-panel-history', { detail: specName }));
}
