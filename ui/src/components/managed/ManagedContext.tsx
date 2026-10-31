import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ManagedContext = createContext(false);
export const useManaged = () => useContext(ManagedContext);

export function ManagedProvider({ children }: { children: ReactNode }) {
  const desktopManaged = window.pilotdeckDesktop?.managed === true;
  const [enabled, setEnabled] = useState(desktopManaged);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch('/api/managed/status', { signal: controller.signal })
      .then(response => response.json()).then(data => {
        setEnabled(desktopManaged || data.enabled === true);
        if (data.enabled && data.sessionValid === false) void window.pilotdeckDesktop?.managedLogout?.().catch(() => {});
      }).catch(() => {});
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [desktopManaged]);
  return <ManagedContext.Provider value={enabled}>{children}</ManagedContext.Provider>;
}
