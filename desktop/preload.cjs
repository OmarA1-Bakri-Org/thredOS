const { contextBridge, shell } = require('electron')

contextBridge.exposeInMainWorld('thredosDesktop', {
  openExternal: (url) => shell.openExternal(url),
})
