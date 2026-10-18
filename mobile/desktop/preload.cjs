const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('HnsDesktop', {
  bundled: true,
  native: true,
  version: ipcRenderer.sendSync('hns-native-version'),
  play: (name, pack) => ipcRenderer.invoke('hns-native-play', name, pack),
  recover: () => ipcRenderer.invoke('hns-native-recover'),
  finish: () => ipcRenderer.invoke('hns-native-finish'),
  checkpoint: () => ipcRenderer.invoke('hns-native-checkpoint'),
  close: () => ipcRenderer.invoke('hns-native-close'),
  show: () => ipcRenderer.invoke('hns-native-show'),
  exportFile: (name, bytes) => ipcRenderer.invoke('hns-native-export', name, bytes),
  onCheckpoint: callback => {
    const listener = (_event, pack) => callback(pack)
    ipcRenderer.on('hns-native-saved', listener)
    return () => ipcRenderer.removeListener('hns-native-saved', listener)
  },
})
