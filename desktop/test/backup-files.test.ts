import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readBackupFile, writeBackupFile } from "../src/main/backup-files";

test("backup file IO round trips JSON and rejects invalid or oversized data",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"polyask-backup-"));
  const path=join(directory,"backup.json");
  try {
    const document={format:"polyask-backup",version:1,exportedAt:100,entries:[]};
    await writeBackupFile(path,document);
    assert.deepEqual(await readBackupFile(path),document);
    assert.ok((await readFile(path,"utf8")).endsWith("\n"));
    await writeFile(path,"not json");
    await assert.rejects(readBackupFile(path),/backup_invalid/);
    await writeFile(path,Buffer.alloc(32*1024*1024+1,32));
    await assert.rejects(readBackupFile(path),/backup_too_large/);
    await assert.rejects(readBackupFile(join(directory,"missing")),/backup_read_failed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test("failed backup export preserves an existing file and removes temporary output",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"polyask-backup-write-"));
  const path=join(directory,"backup.json");
  try {
    await writeFile(path,"original");
    await assert.rejects(writeBackupFile(path,{huge:"x".repeat(32*1024*1024)}),/backup_too_large/);
    assert.equal(await readFile(path,"utf8"),"original");
    assert.deepEqual(await readdir(directory),["backup.json"]);
    await assert.rejects(writeBackupFile(join(directory,"missing","file.json"),{}),/backup_write_failed/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
