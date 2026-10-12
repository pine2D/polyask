// 原生代理检查的外壳 preload：只放行六个代理通道，并记录主进程推送的 proxy-state-changed。
// 生产 preload 的方法名由 T14 决定；这里验证的是主进程 IPC、trusted 校验与推送通道本身。
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['polyask:proxy-state', 'polyask:proxy-set', 'polyask:proxy-follow',
  'polyask:proxy-accept', 'polyask:proxy-test', 'polyask:proxy-reload-sites']);
const pushes = [];
ipcRenderer.on('polyask:proxy-state-changed', (_event, state) => { pushes.push(state); });
contextBridge.exposeInMainWorld('proxyCheck', {
  invoke: (channel, payload) => CHANNELS.has(channel)
    ? ipcRenderer.invoke(channel, payload) : Promise.reject(new Error('channel_not_allowed')),
  pushes: () => pushes.slice()
});
