import { ipcMain } from "electron";
import { isFolderTarget, validFolderId, type FolderFilters, type FolderMembershipChange } from "../shared/task-folder";
import type { TaskFolderService } from "./task-folder-service";

interface IpcEvent {readonly sender:Electron.WebContents;readonly senderFrame:Electron.WebFrameMain|null}
const CHANNELS=["polyask:folder-list","polyask:folder-create","polyask:folder-rename","polyask:folder-delete",
  "polyask:folder-search","polyask:folder-memberships","polyask:folder-memberships-patch"] as const;
function object(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_request");
  return value as Record<string,unknown>;
}
export function registerTaskFolderIpc(options:{readonly folders:TaskFolderService;readonly trusted:(event:IpcEvent)=>boolean}):()=>void {
  const handle=(channel:typeof CHANNELS[number],run:(value:unknown)=>unknown)=>{
    ipcMain.handle(channel,(event,value:unknown)=>{
      if(!options.trusted(event))throw new Error("untrusted_sender");
      return run(value);
    });
  };
  handle(CHANNELS[0],()=>options.folders.list());
  handle(CHANNELS[1],value=>options.folders.create(value));
  handle(CHANNELS[2],value=>{
    const v=object(value);
    if(!validFolderId(v.id))throw new Error("invalid_request");
    return options.folders.rename(v.id,v.name);
  });
  handle(CHANNELS[3],value=>{
    if(!validFolderId(value))throw new Error("invalid_request");
    return options.folders.delete(value);
  });
  handle(CHANNELS[4],value=>options.folders.search((value===undefined?{}:object(value)) as FolderFilters));
  handle(CHANNELS[5],value=>{
    if(!isFolderTarget(value))throw new Error("invalid_request");
    return options.folders.memberships(value);
  });
  handle(CHANNELS[6],value=>{
    const v=object(value);
    if(!isFolderTarget(v.target)||!Array.isArray(v.changes))throw new Error("invalid_request");
    return options.folders.patchMemberships(v.target,v.changes as FolderMembershipChange[]);
  });
  return ()=>{for(const channel of CHANNELS)ipcMain.removeHandler(channel);};
}
