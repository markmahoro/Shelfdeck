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
  getLibraryItem: (args) => ipcRenderer.invoke('emby:getLibraryItem', args),
  getItemDeleteInfo: (args) => ipcRenderer.invoke('emby:getItemDeleteInfo', args),
  deleteLibraryItem: (args) => ipcRenderer.invoke('emby:deleteLibraryItem', args),
  libraryItemExists: (args) => ipcRenderer.invoke('emby:libraryItemExists', args),
  taskControl: (args) => ipcRenderer.invoke('taskControl', args),
  transcodeValidateTools: (args) => ipcRenderer.invoke('transcode:validateTools', args),
  transcodePrecheck: (args) => ipcRenderer.invoke('transcode:precheck', args),
  transcodeStartEncode: (args) => ipcRenderer.invoke('transcode:startEncode', args),
  transcodeAbort: (args) => ipcRenderer.invoke('transcode:abort', args),
  transcodeProbe: (args) => ipcRenderer.invoke('transcode:probe', args),
  transcodeReplace: (args) => ipcRenderer.invoke('transcode:replace', args),
  transcodeCleanupTaskWorkdir: (args) => ipcRenderer.invoke('transcode:cleanupTaskWorkdir', args),
  transcodeScanOrphans: (args) => ipcRenderer.invoke('transcode:scanOrphans', args),
  transcodeDeletePaths: (args) => ipcRenderer.invoke('transcode:deletePaths', args),
  onTranscodeProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('transcode:progress', handler);
    return () => ipcRenderer.removeListener('transcode:progress', handler);
  },
};

const doubanApi = {
  saveSession: (payload) => ipcRenderer.invoke('douban:saveSession', payload),
  getSession: () => ipcRenderer.invoke('douban:getSession'),
  stopFetch: () => ipcRenderer.invoke('douban:stopFetch'),
  fetchRatings: (opts) => ipcRenderer.invoke('douban:fetchRatings', opts ?? {}),
  onProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('douban:fetchProgress', handler);
    return () => ipcRenderer.removeListener('douban:fetchProgress', handler);
  },
};

contextBridge.exposeInMainWorld('embyApi', embyApi);
contextBridge.exposeInMainWorld('doubanApi', doubanApi);
