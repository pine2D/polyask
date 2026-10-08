// The fixture uses the production shell API; this extra channel reports actual native geometry only.
import '../../src/preload/shell';
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('motionTest', {
  onNative: (listener: (bounds: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, bounds: unknown) => listener(bounds);
    ipcRenderer.on('motion:native', handler);
    return () => ipcRenderer.removeListener('motion:native', handler);
  }
});
