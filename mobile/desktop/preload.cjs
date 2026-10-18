const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('HnsDesktop', { bundled: true })
