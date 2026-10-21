import { dialog, ipcMain, type BrowserWindow } from "electron";
import { basename } from "node:path";
import type { BackupService } from "./backup-service";
import type { BackupExportMode } from "../shared/backup";

interface BackupIpcEvent {readonly sender:Electron.WebContents;readonly senderFrame:Electron.WebFrameMain|null}
const CHANNELS=["polyask:backup-export","polyask:backup-preview","polyask:backup-apply","polyask:backup-cancel","polyask:backup-selection-preview"] as const;
const CODES=new Set(["backup_invalid","backup_version","backup_stale","backup_selection","backup_missing","backup_too_large",
  "backup_images_missing","backup_read_failed","backup_write_failed","backup_dependency","backup_busy","invalid_request"]);
const token=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=128;
function selection(value: unknown): { token: string; selectedKeys: string[] } {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_request");
  const v=value as {token?:unknown;selectedKeys?:unknown};
  if(!token(v.token)||!Array.isArray(v.selectedKeys)||v.selectedKeys.length>20_000||v.selectedKeys.some(k=>typeof k!=="string"||k.length>1024))throw new Error("invalid_request");
  return { token: v.token, selectedKeys: v.selectedKeys };
}

export function registerBackupIpc(options:{readonly window:BrowserWindow;readonly backup:BackupService;
  readonly fetchAttachments?:(questionId:string)=>Promise<boolean>;
  readonly trusted:(event:BackupIpcEvent)=>boolean;readonly afterApply:()=>void}):()=>void {
  let busy=false,disposed=false;
  const handle=(channel:typeof CHANNELS[number],action:(value:unknown)=>unknown|Promise<unknown>)=>{
    ipcMain.handle(channel,async(event,value:unknown)=>{
      if(!options.trusted(event))throw new Error("untrusted_sender");
      const cancelling=channel==="polyask:backup-cancel";
      if((busy&&!cancelling)||disposed)throw new Error("backup_busy");
      if(!cancelling)busy=true;
      try {return await action(value);}
      catch(error){throw new Error(error instanceof Error&&CODES.has(error.message)?error.message:"backup_failed");}
      finally{if(!cancelling)busy=false;}
    });
  };
  handle(CHANNELS[0],async value=>{
    const mode: BackupExportMode = value === undefined ? 'complete' : (value as any)?.mode;
    if (!['complete','download','text-only'].includes(mode) || (value !== undefined &&
      (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key=>key!=='mode')))) throw new Error('invalid_request');
    const guard=options.backup.beginOperation();
    if(mode!=='text-only') {
      let missing=await options.backup.missingOriginals(guard); guard();
      if(mode==='download') {
        for(const item of missing) {
          guard(); await options.fetchAttachments?.(item.questionId); guard();
        }
        missing=await options.backup.missingOriginals(guard); guard();
      }
      if(missing.length)return {missing};
    }
    const result=await dialog.showSaveDialog(options.window,{defaultPath:`polyask-backup-${new Date().toISOString().slice(0,10)}.polyask`,filters:[{name:"PolyAsk",extensions:["polyask"]}]});
    if(result.canceled||!result.filePath||disposed)return false;
    guard();
    await options.backup.exportFile(result.filePath,mode==='text-only'?'text-only':'complete',guard);
    guard(); return mode==='text-only'?'text-only':true;
  });
  handle(CHANNELS[1],async()=>{
    const guard=options.backup.beginOperation();
    const result=await dialog.showOpenDialog(options.window,{properties:["openFile"],filters:[{name:"PolyAsk",extensions:["polyask","json"]}]});
    if(result.canceled||!result.filePaths[0]||disposed)return null;
    guard();
    const preview=await options.backup.previewFile(result.filePaths[0],guard);
    guard(); return { ...preview, filename: basename(result.filePaths[0]) };
  });
  handle(CHANNELS[2],value=>{
    const v=selection(value);
    const result=options.backup.apply(v.token,v.selectedKeys);
    // Committed data must not be reported as a failed import if view refresh fails.
    try {options.afterApply();}catch{console.warn("backup_refresh_failed");}
    return result;
  });
  handle(CHANNELS[3],value=>{
    if(!token(value))throw new Error("invalid_request");
    options.backup.cancel(value);
  });
  handle(CHANNELS[4],value=>{
    const v=selection(value);
    return options.backup.previewSelection(v.token,v.selectedKeys);
  });
  return ()=>{disposed=true;options.backup.dispose();for(const channel of CHANNELS)ipcMain.removeHandler(channel);};
}
