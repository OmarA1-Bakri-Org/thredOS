const { contextBridge, shell, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('thredosDesktop', {
  openExternal: (url) => shell.openExternal(url),
  getPendingActivationUrl: () => ipcRenderer.invoke('thredos:get-pending-activation-url'),
  consumePendingActivationUrl: () => ipcRenderer.invoke('thredos:consume-pending-activation-url'),
  onActivationUrl: (callback) => {
    const listener = (_event, url) => callback(url)
    ipcRenderer.on('thredos:activation-url', listener)
    return () => ipcRenderer.removeListener('thredos:activation-url', listener)
  },
})
