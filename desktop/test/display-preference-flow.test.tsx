import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import type { DisplayPreferences } from '../src/shared/display';
import { useDisplayPreferences } from '../src/renderer/use-display-preferences';
import { setShellApi } from '../src/renderer/shell-api';
import { mountDom } from './ui/dom-harness';

const initial: DisplayPreferences = { density: 'compact', siteScale: 0.9 };
const next: DisplayPreferences = { density: 'comfortable', siteScale: 0.9 };
let state!: ReturnType<typeof useDisplayPreferences>;
function Fixture() {
  state = useDisplayPreferences(initial, () => undefined);
  return <output>{JSON.stringify(state.value)}</output>;
}

test('successful settings updates publish the accepted preference to controls and local storage', async () => {
  const accepted: DisplayPreferences = { density: 'comfortable', siteScale: 1 };
  setShellApi({ setDisplayPreferences: async () => accepted } as any);
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => { await state.save(next); });
    assert.equal(h.document.querySelector('output')!.textContent, JSON.stringify(accepted));
    assert.equal(h.document.documentElement.dataset.density, 'comfortable');
    assert.equal(h.window.localStorage.getItem('polyask.display'), JSON.stringify(accepted));
  } finally { await h.close(); setShellApi(null); }
});

test('rejected settings writes leave the accepted preference unchanged', async () => {
  setShellApi({ setDisplayPreferences: async () => { throw new Error('rejected'); } } as any);
  const h = await mountDom(<Fixture />);
  try {
    await act(async () => { await assert.rejects(state.save(next), /rejected/); });
    assert.equal(h.document.querySelector('output')!.textContent, JSON.stringify(initial));
    assert.equal(h.window.localStorage.getItem('polyask.display'), null);
  } finally { await h.close(); setShellApi(null); }
});

test('a newer menu push survives a delayed settings reply', async () => {
  let finish!: (value: DisplayPreferences) => void;
  setShellApi({ setDisplayPreferences: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await mountDom(<Fixture />);
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = state.save(next); });
    const menu: DisplayPreferences = { density: 'compact', siteScale: 1 };
    await act(async () => { state.accept(menu); });
    await act(async () => { finish(next); await pending; });
    assert.equal(h.document.querySelector('output')!.textContent, JSON.stringify(menu));
    assert.equal(h.window.localStorage.getItem('polyask.display'), JSON.stringify(menu));
  } finally { await h.close(); setShellApi(null); }
});

test('a display reply after unmount does not touch the departed document', async () => {
  let finish!: (value: DisplayPreferences) => void;
  setShellApi({ setDisplayPreferences: () => new Promise(resolve => { finish = resolve; }) } as any);
  const h = await mountDom(<Fixture />);
  let pending!: Promise<void>;
  try {
    await act(async () => { pending = state.save(next); });
    await h.close();
    finish(next);
    await assert.doesNotReject(pending);
  } finally { setShellApi(null); }
});
