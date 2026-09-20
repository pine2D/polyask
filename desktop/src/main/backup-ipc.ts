import { dialog, ipcMain, type BrowserWindow } from "electron";
import { basename } from "node:path";
import type { BackupService } from "./backup-service";
import { readBackupFile, writeBackupFile } from "./backup-files";

interface BackupIpcEvent {readonly sender:Electron.WebContents;readonly senderFrame:Electron.WebFrameMain|null}
const CHANNELS=["polyask:backup-export","polyask:backup-preview","polyask:backup-apply","polyask:backup-cancel"] as const;
const CODES=new Set(["backup_invalid","backup_version","backup_stale","backup_selection","backup_missing","backup_too_large",
  "backup_read_failed","backup_write_failed","backup_dependency","backup_busy","invalid_request"]);
const token=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=128;

export function registerBackupIpc(options:{readonly window:BrowserWindow;readonly backup:BackupService;
  readonly trusted:(event:BackupIpcEvent)=>boolean;readonly afterApply:()=>void}):()=>void {
  let busy=false,disposed=false;
  const handle=(channel:typeof CHANNELS[number],action:(value:unknown)=>unknown|Promise<unknown>)=>{
    ipcMain.handle(channel,async(event,value:unknown)=>{
      if(!options.trusted(event))throw new Error("untrusted_sender");
      if(busy||disposed)throw new Error("backup_busy");
      busy=true;
      try {return await action(value);}
      catch(error){throw new Error(error instanceof Error&&CODES.has(error.message)?error.message:"backup_failed");}
      finally{busy=false;}
    });
  };
  handle(CHANNELS[0],async()=>{
    const result=await dialog.showSaveDialog(options.window,{defaultPath:`polyask-backup-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:"JSON",extensions:["json"]}]});
    if(result.canceled||!result.filePath||disposed)return false;
    await writeBackupFile(result.filePath,options.backup.export());
    return true;
  });
  handle(CHANNELS[1],async()=>{
    const result=await dialog.showOpenDialog(options.window,{properties:["openFile"],filters:[{name:"JSON",extensions:["json"]}]});
    if(result.canceled||!result.filePaths[0]||disposed)return null;
    const document=await readBackupFile(result.filePaths[0]);
    if(disposed)return null;
    return { ...options.backup.preview(document), filename: basename(result.filePaths[0]) };
  });
  handle(CHANNELS[2],value=>{
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_request");
    const v=value as {token?:unknown;selectedKeys?:unknown};
    if(!token(v.token)||!Array.isArray(v.selectedKeys)||v.selectedKeys.length>20_000||v.selectedKeys.some(k=>typeof k!=="string"||k.length>1024))throw new Error("invalid_request");
    const result=options.backup.apply(v.token,v.selectedKeys);
    // Committed data must not be reported as a failed import if view refresh fails.
    try {options.afterApply();}catch{console.warn("backup_refresh_failed");}
    return result;
  });
  handle(CHANNELS[3],value=>{
    if(!token(value))throw new Error("invalid_request");
    options.backup.cancel(value);
  });
  return ()=>{disposed=true;for(const channel of CHANNELS)ipcMain.removeHandler(channel);};
}
