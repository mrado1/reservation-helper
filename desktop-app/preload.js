const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('ra', {
  getCookies: () => ipcRenderer.invoke('getCookies'),
  onCookieChanged: (cb) => {
    const handler = (_e, c) => cb(c);
    ipcRenderer.on('cookieChanged', handler);
    return () => ipcRenderer.removeListener('cookieChanged', handler);
  },
  openExternal: (url) => shell.openExternal(url),
  authProbe: () => ipcRenderer.invoke('auth:probe'),
  
  // Context extraction API
  getContext: () => ipcRenderer.invoke('ra:getContext'),
  onContextChanged: (cb) => {
    const handler = (_e, ctx) => cb(ctx);
    ipcRenderer.on('ra:context', handler);
    return () => ipcRenderer.removeListener('ra:context', handler);
  },
  
  // Polling API
  startPolling: (formData) => ipcRenderer.invoke('ra:startPolling', formData),
  stopPolling: () => ipcRenderer.invoke('ra:stopPolling'),
  onPollingStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('ra:pollingStatus', handler);
    return () => ipcRenderer.removeListener('ra:pollingStatus', handler);
  },
  
  // M6: Probe and cart APIs
  probeAddItem: (formData) => ipcRenderer.invoke('ra:probeAddItem', formData),
  getCart: () => ipcRenderer.invoke('ra:getCart'),
  onNavigateToCart: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('ra:navigateToCart', handler);
    return () => ipcRenderer.removeListener('ra:navigateToCart', handler);
  },

  // M9: Logs APIs
  getLogs: () => ipcRenderer.invoke('ra:getLogs'),
  onLogsUpdated: (cb) => {
    const handler = (_e, entries) => cb(entries);
    ipcRenderer.on('ra:logsUpdated', handler);
    return () => ipcRenderer.removeListener('ra:logsUpdated', handler);
  },
  clearLogs: () => ipcRenderer.invoke('ra:clearLogs'),
  
  // M10: Auto-update APIs
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('update:available', handler);
    return () => ipcRenderer.removeListener('update:available', handler);
  },
  onUpdateProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  
  // M10: Feature flags API
  getFeatureFlags: () => ipcRenderer.invoke('flags:get')
});



