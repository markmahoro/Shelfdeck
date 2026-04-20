'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayCtl', {
  snapshot: () => ipcRenderer.invoke('tray:snapshot'),
  saveConnection: (payload) => ipcRenderer.invoke('tray:save-connection', payload),
  startService: () => ipcRenderer.invoke('tray:start-service'),
  stopService: () => ipcRenderer.invoke('tray:stop-service'),
  restartService: () => ipcRenderer.invoke('tray:restart-service'),
  openDesktop: () => ipcRenderer.invoke('tray:open-desktop'),
  updateSettings: (payload) => ipcRenderer.invoke('tray:update-settings', payload),
});
