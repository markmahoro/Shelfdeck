const { contextBridge, ipcRenderer } = require('electron');

const embyApi = {
  testConnection: (config) => ipcRenderer.invoke('emby:testConnection', config),
  getUsers: (config) => ipcRenderer.invoke('emby:getUsers', config),
  getMediaFolders: (config) => ipcRenderer.invoke('emby:getMediaFolders', config),
  getUnplayedItems: (args) => ipcRenderer.invoke('emby:getUnplayedItems', args),
  getLibraryItemsForManage: (args) => ipcRenderer.invoke('emby:getLibraryItemsForManage', args),
  getPlayedItems: (args) => ipcRenderer.invoke('emby:getPlayedItems', args),
  launchPlayer: (args) => ipcRenderer.invoke('emby:launchPlayer', args),
  markPlayed: (args) => ipcRenderer.invoke('emby:markPlayed', args),
  markUnplayed: (args) => ipcRenderer.invoke('emby:markUnplayed', args),
  taskControl: (args) => ipcRenderer.invoke('taskControl', args),
};

const doubanApi = {
  saveSession: (payload) => ipcRenderer.invoke('douban:saveSession', payload),
  getSession: () => ipcRenderer.invoke('douban:getSession'),
  stopFetch: () => ipcRenderer.invoke('douban:stopFetch'),
  fetchRatings: () => ipcRenderer.invoke('douban:fetchRatings'),
  onProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('douban:fetchProgress', handler);
    return () => ipcRenderer.removeListener('douban:fetchProgress', handler);
  },
};

contextBridge.exposeInMainWorld('embyApi', embyApi);
contextBridge.exposeInMainWorld('doubanApi', doubanApi);
