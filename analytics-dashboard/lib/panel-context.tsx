'use client';
import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface PanelCtx {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const Ctx = createContext<PanelCtx>({ isOpen: false, open: () => {}, close: () => {} });

export function PanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open  = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Allow any component to open the panel via a DOM event
  useEffect(() => {
    const h = () => setIsOpen(true);
    window.addEventListener('open-agent-panel', h);
    return () => window.removeEventListener('open-agent-panel', h);
  }, []);

  return <Ctx.Provider value={{ isOpen, open, close }}>{children}</Ctx.Provider>;
}

export const usePanelCtx = () => useContext(Ctx);

// Call this from anywhere to open the panel
export function openAgentPanel() {
  window.dispatchEvent(new Event('open-agent-panel'));
}
