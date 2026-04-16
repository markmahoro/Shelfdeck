const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('embyApi', {
  testConnection: (config) => ipcRenderer.invoke('emby:testConnection', config),
  getUsers: (config) => ipcRenderer.invoke('emby:getUsers', config),
  getMediaFolders: (config) => ipcRenderer.invoke('emby:getMediaFolders', config),
  getUnplayedItems: (args) => ipcRenderer.invoke('emby:getUnplayedItems', args),
  getPlayedItems: (args) => ipcRenderer.invoke('emby:getPlayedItems', args),
  launchPlayer: (args) => ipcRenderer.invoke('emby:launchPlayer', args),
  markPlayed: (args) => ipcRenderer.invoke('emby:markPlayed', args),
  markUnplayed: (args) => ipcRenderer.invoke('emby:markUnplayed', args),
});
