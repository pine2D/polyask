// The fixture samples the actual view bounds from the same IPC delivery as the production layout.
import '../../src/preload/shell';
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('motionTest', {
  onNative: (listener: (bounds: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, _layout: unknown, bounds: unknown) => listener(bounds);
    ipcRenderer.on('polyask:layout', handler);
    return () => ipcRenderer.removeListener('polyask:layout', handler);
  }
});
