const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('embyApi', {
  testConnection: (config) => ipcRenderer.invoke('emby:testConnection', config),
  getUsers: (config) => ipcRenderer.invoke('emby:getUsers', config),
  getMediaFolders: (config) => ipcRenderer.invoke('emby:getMediaFolders', config),
  getUnplayedItems: (args) => ipcRenderer.invoke('emby:getUnplayedItems', args),
  launchPlayer: (args) => ipcRenderer.invoke('emby:launchPlayer', args),
  markPlayed: (args) => ipcRenderer.invoke('emby:markPlayed', args),
});
