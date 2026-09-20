import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { BackupComparison, eligibleBackupSelection, initialBackupSelection } from "../src/renderer/backup-comparison";
import { getCopy } from "../src/shared/copy";

const item = (status: string, blocked = false) => ({ key: status, id: status, kind: "archive", title: "Saved answer", status, local: { task: "Local text" }, backup: { task: "Backup text" }, blocked });
test("backup defaults only include available new records", () => {
  assert.deepEqual([...initialBackupSelection([item("new"), item("same"), item("deleted"), item("conflict"), { ...item("new", true), key: "blocked" }] as never)], ["new"]);
});
test("conflict comparison uses designed explicit choices and renders both complete versions", () => {
  const html = renderToStaticMarkup(<BackupComparison copy={getCopy("en")} item={item("conflict") as never} selected={false} onSelect={() => undefined} />);
  assert.match(html, /Local text/); assert.match(html, /Backup text/);
  assert.match(html, /aria-pressed="true"/); assert.match(html, /Keep local/); assert.match(html, /Use backup/);
  assert.doesNotMatch(html, /<select/);
});
test("deleted restoration is unchecked and must be explicitly selected", () => {
  const html = renderToStaticMarkup(<BackupComparison copy={getCopy("zh-CN")} item={item("deleted") as never} selected={false} onSelect={() => undefined} />);
  assert.match(html, /type="checkbox"/); assert.doesNotMatch(html, /checked/);
});

test("selected links with unselected dependencies remain skipped without selecting extra content", () => {
  const items = [{ ...item("new"), key: "link", requires: ["folder"] }, { ...item("deleted"), key: "folder" }];
  const selected = new Set(["link"]);
  assert.deepEqual([...eligibleBackupSelection(items as never, selected)], []);
  assert.deepEqual([...selected], ["link"]);
  assert.deepEqual([...eligibleBackupSelection(items as never, new Set(["link", "folder"]))], ["link", "folder"]);
});
test("comparison omits internal identity and derived search previews while retaining content", () => {
  const record = {...item("conflict"), backup: { task: "Full content", schema: 1, textHash: "secret-internal-hash", searchText: "duplicate-search" } };
  const html = renderToStaticMarkup(<BackupComparison copy={getCopy("en")} item={record as never} selected={false} onSelect={() => undefined} />);
  assert.match(html, /Full content/); assert.doesNotMatch(html, /secret-internal-hash|duplicate-search|Format version/);
});

test("reused folders enable mappings but do not count as restored writes", () => {
  const items = [{ ...item("new"), key: "link", requires: ["folder"] }, { ...item("deleted"), key: "folder", note: "folder_reused" }];
  const selected = new Set(["link", "folder"]);
  assert.deepEqual([...eligibleBackupSelection(items as never, selected)], ["link"]);
  assert.deepEqual([...selected], ["link", "folder"]);
});
