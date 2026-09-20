import { randomUUID } from "node:crypto";
import { folderMembershipId, isFolderTarget, validFolderId, validFolderName,
  type TaskFolder, type FolderTarget, type FolderMembershipChange, type FolderFilters, type FolderContent } from "../shared/task-folder";
import type { TaskFolderRepository } from "./task-folder-repository";
import type { ArchiveService } from "./archive-service";
import type { DecisionService } from "./decision-service";

interface Options {readonly deviceId:()=>string;readonly now?:()=>number;readonly createId?:()=>string}
export class TaskFolderService {
  private readonly now:()=>number;
  private readonly createId:()=>string;
  constructor(private readonly repository:TaskFolderRepository,private readonly archives:ArchiveService,
    private readonly decisions:DecisionService,private readonly options:Options) {
    this.now=options.now??Date.now;this.createId=options.createId??randomUUID;
  }
  list():TaskFolder[] {return this.repository.list();}
  create(name:unknown):TaskFolder {
    if (!validFolderName(name)) throw new Error("invalid_request");
    const now=this.now();
    return this.repository.put({id:this.createId(),name:name.trim(),createdAt:now,updatedAt:now,deviceId:this.options.deviceId(),schema:3}) as TaskFolder;
  }
  rename(id:string,name:unknown):TaskFolder {
    if (!validFolderId(id)||!validFolderName(name)) throw new Error("invalid_request");
    const current=this.repository.get(id);
    if (!current||"deletedAt" in current) throw new Error("not_found");
    return this.repository.put({...current,name:name.trim(),updatedAt:Math.max(this.now(),current.updatedAt+1),deviceId:this.options.deviceId()}) as TaskFolder;
  }
  delete(id:string):void {
    if (!validFolderId(id)) throw new Error("invalid_request");
    if (!this.repository.delete(id,this.now(),this.options.deviceId())) throw new Error("not_found");
  }
  clear():number {
    const folders=this.list();
    this.repository.transaction(()=>{for(const f of folders)this.delete(f.id);});
    return folders.length;
  }
  memberships(target:FolderTarget):string[] {
    if (!isFolderTarget(target)) throw new Error("invalid_request");
    const live=new Set(this.list().map(f=>f.id));
    return this.repository.listMemberships().filter(m=>!("deletedAt" in m)&&live.has(m.folderId)&&
      m.targetKind===target.kind&&m.targetId===target.id).map(m=>m.folderId);
  }
  patchMemberships(target:FolderTarget,changes:readonly FolderMembershipChange[]):string[] {
    if (!isFolderTarget(target)||!Array.isArray(changes)||changes.length>1000||
      changes.some(c=>!c||!validFolderId(c.folderId)||typeof c.present!=="boolean")||
      new Set(changes.map(c=>c.folderId)).size!==changes.length) throw new Error("invalid_request");
    if (!(target.kind==="archive"?this.archives.get(target.id):this.decisions.get(target.id))) throw new Error("not_found");
    this.repository.transaction(()=>{
      for(const change of changes) {
        const folder=this.repository.get(change.folderId);
        if (change.present&&(!folder||"deletedAt" in folder)) throw new Error("not_found");
        const id=folderMembershipId(target,change.folderId),current=this.repository.getMembership(id);
        if ((!current||"deletedAt" in current)&&!change.present) continue;
        if (current&&!("deletedAt" in current)&&change.present) continue;
        const stamp=Math.max(this.now(),(current?.updatedAt??-1)+1);
        this.repository.putMembership({id,folderId:change.folderId,targetKind:target.kind,targetId:target.id,
          createdAt:current?.createdAt??stamp,updatedAt:stamp,deviceId:this.options.deviceId(),schema:3,
          ...(!change.present?{deletedAt:stamp}:{})});
      }
    });
    return this.memberships(target);
  }
  search(filters:FolderFilters={}):FolderContent[] {
    if (!filters||typeof filters!=="object"||Array.isArray(filters)||
      (filters.kind!==undefined&&!["","archive","decision"].includes(filters.kind))||
      (filters.status!==undefined&&!["","draft","verify","final"].includes(filters.status))||
      [filters.folderId,filters.query,filters.tag].some(v=>v!==undefined&&typeof v!=="string")||
      (filters.favorite!==undefined&&typeof filters.favorite!=="boolean")) throw new Error("invalid_request");
    const result:FolderContent[]=[];
    if(filters.kind!=="decision")for(const record of this.archives.search({query:filters.query,tag:filters.tag,favorite:filters.favorite}).items)result.push({kind:"archive",record});
    if(filters.kind!=="archive")for(const record of this.decisions.search({query:filters.query,status:filters.status}))result.push({kind:"decision",record});
    const folders=new Set(this.list().map(f=>f.id)),linked=new Set<string>(),selected=new Set<string>();
    for(const m of this.repository.listMemberships()) {
      if ("deletedAt" in m||!folders.has(m.folderId))continue;
      const key=`${m.targetKind}:${m.targetId}`;
      linked.add(key);if(m.folderId===filters.folderId)selected.add(key);
    }
    return result.filter(item=>!filters.folderId||(filters.folderId==="__unfiled__"?!linked.has(`${item.kind}:${item.record.id}`):selected.has(`${item.kind}:${item.record.id}`)))
      .sort((a,b)=>b.record.updatedAt-a.record.updatedAt||a.record.id.localeCompare(b.record.id)||a.kind.localeCompare(b.kind));
  }
}
