import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { inspectBroadcastSite } from '../src/renderer/broadcast-site-inspection';
import { readSource } from './fixtures';
import { resolveFocusedSite, resolveSitePage, resolveSitePageIndex } from '../src/shared/site-pages';

test('inspection checks current selection without silently selecting or focusing another site', async () => {
  const selected = new Set(['chatgpt']);
  const focused: string[] = [], unavailable: string[] = [];
  const options = {isSelected: (site: string) => selected.has(site),
    focus: async (site: string) => { focused.push(site); return true; }, unavailable: (site: string) => { unavailable.push(site); }};
  await inspectBroadcastSite('claude', options);
  assert.deepEqual(focused, []);
  assert.deepEqual(unavailable, ['claude']);
  assert.deepEqual([...selected], ['chatgpt']);
  selected.add('claude');
  await inspectBroadcastSite('claude', options);
  assert.deepEqual(focused, ['claude']);
});

test('a main-process rejection is visible even when renderer selection is stale', async () => {
  const unavailable: string[] = [];
  await inspectBroadcastSite('claude', {isSelected: () => true, focus: async () => false,
    unavailable: site => { unavailable.push(site); }});
  assert.deepEqual(unavailable, ['claude']);
});

test('a malformed inspection acknowledgement fails closed', async () => {
  let unavailable = 0;
  await inspectBroadcastSite('claude', {isSelected: () => true, focus: async () => [] as unknown as boolean,
    unavailable: () => { unavailable++; }});
  assert.equal(unavailable, 1);
});

test('a departed inspection reply cannot change the newer surface', async () => {
  let release: (accepted: boolean) => void = () => {};
  const response = new Promise<boolean>(resolve => { release = resolve; });
  let active = true, unavailable = 0;
  const pending = inspectBroadcastSite('claude', {isSelected: () => true, focus: () => response,
    unavailable: () => { unavailable++; }, active: () => active});
  active = false; release(false); await pending;
  assert.equal(unavailable, 0);
});

test('ViewManager refuses a stale focus request for a site outside current selection', () => {
  // Run the actual production method; real page resolution remains authoritative,
  // while view I/O is counted so a fallback focus is observable without Electron.
  const source = ts.createSourceFile('view-manager.ts', readSource('src/main/view-manager.ts'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ViewManager') as ts.ClassDeclaration;
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'setLayout') as ts.MethodDeclaration;
  const body = ts.transpileModule(`function ${method.getText(source)}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  let reconciles = 0, focuses = 0;
  const manager = {selected: ['chatgpt'], focused: 'chatgpt', page: 0, mode: 'overview', surface: 'sites',
    focusOrder: ['chatgpt'], focusedByPage: new Map(), views: new Map([['chatgpt', {webContents: {isDestroyed: () => false, focus: () => { focuses++; }}}]]),
    reconcileViews: () => { reconciles++; }, clearVisibleUnread: () => {}, layout: () => {}};
  const accepted = vm.runInNewContext(`${body}\nsetLayout.call(manager, 'focus', 'claude');`, {manager,
    resolveFocusedSite, resolveSitePage, resolveSitePageIndex, swapFocusedSite: (value: unknown) => value});
  assert.equal(accepted, false);
  assert.equal(focuses, 0);
  assert.equal(reconciles, 0);
  assert.equal(manager.mode, 'overview');
  assert.equal(manager.focused, 'chatgpt');
});

test('ViewManager acknowledges only a successfully selected focus target', () => {
  const source = ts.createSourceFile('view-manager.ts', readSource('src/main/view-manager.ts'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ViewManager') as ts.ClassDeclaration;
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'setLayout') as ts.MethodDeclaration;
  const body = ts.transpileModule(`function ${method.getText(source)}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  let focuses = 0;
  const manager = {selected: ['claude'], focused: 'claude', page: 0, mode: 'overview', surface: 'sites',
    focusOrder: ['claude'], focusedByPage: new Map(), views: new Map([['claude', {webContents: {isDestroyed: () => false, focus: () => { focuses++; }}}]]),
    reconcileViews: () => {}, clearVisibleUnread: () => {}, layout: () => {}};
  const accepted = vm.runInNewContext(`${body}\nsetLayout.call(manager, 'focus', 'claude');`, {manager,
    resolveFocusedSite, resolveSitePage, resolveSitePageIndex, swapFocusedSite: (value: unknown) => value});
  assert.equal(accepted, true);
  assert.equal(focuses, 1);
  assert.equal(manager.focused, 'claude');
});
