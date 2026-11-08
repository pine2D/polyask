const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('baselineQuery', request => ipcRenderer.invoke('polyask:folder-query', request));
