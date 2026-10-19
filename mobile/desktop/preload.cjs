const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('HnsDesktop', {
  bundled: true,
  native: true,
  version: ipcRenderer.sendSync('hns-native-version'),
  play: (name, pack) => ipcRenderer.invoke('hns-native-play', name, pack),
  recover: () => ipcRenderer.invoke('hns-native-recover'),
  finish: () => ipcRenderer.invoke('hns-native-finish'),
  checkpoint: () => ipcRenderer.invoke('hns-native-checkpoint'),
  checkSaveCompatibility: pack => ipcRenderer.invoke('hns-native-compatible', pack),
  close: () => ipcRenderer.invoke('hns-native-close'),
  reportError: message => ipcRenderer.invoke('hns-native-error', message),
  exportFile: (name, bytes) => ipcRenderer.invoke('hns-native-export', name, bytes),
  importFile: () => ipcRenderer.invoke('hns-native-import'),
  menuStarted: id => ipcRenderer.invoke('hns-native-menu-started', id),
  answerAction: (id, data, pack) => ipcRenderer.invoke('hns-native-answer', id, data, pack),
  onAction: callback => {
    const listener = (_event, action, pack) => callback(action, pack)
    ipcRenderer.on('hns-native-action', listener)
    return () => ipcRenderer.removeListener('hns-native-action', listener)
  },
  onCheckpoint: callback => {
    const listener = (_event, pack) => callback(pack)
    ipcRenderer.on('hns-native-saved', listener)
    return () => ipcRenderer.removeListener('hns-native-saved', listener)
  },
})
