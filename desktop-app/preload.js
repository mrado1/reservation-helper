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
  clearLogs: () => ipcRenderer.invoke('ra:clearLogs')
});



