import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pilotdeckManagedLogin', {
  submit: (action: string, input: unknown) => ipcRenderer.invoke('pilotdeck:managed-auth', action, input),
  savedAccounts: () => ipcRenderer.invoke('pilotdeck:managed-saved-accounts'),
});
