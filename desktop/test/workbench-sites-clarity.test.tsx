import assert from 'node:assert/strict';
import test from 'node:test';
import { SITES } from '../src/main/sites';
import type { SiteKey } from '../src/shared/contracts';
import { getCopy } from '../src/shared/copy';
import { WorkspaceSites } from '../src/renderer/workspace-sites';
import { readSource } from './fixtures';
import { mountDom } from './ui/dom-harness';

const mount = (locale: string, participating: readonly SiteKey[]) => mountDom(<WorkspaceSites copy={getCopy(locale)} sites={SITES}
  selected={new Set(participating)} participating={new Set(participating)} groups={[]}
  onSelectionChange={() => undefined} onParticipationChange={() => undefined} onCloseSitePage={() => undefined}
  onSaveGroup={async () => true} onDeleteGroup={() => undefined} />);

for (const locale of ['en', 'zh-CN', 'zh-TW']) test(`${locale}: closing a page is visually and verbally distinct from unchecking`, async () => {
  const copy = getCopy(locale);
  const h = await mount(locale, ['claude', 'kimi']);
  try {
    const close = h.document.querySelector<HTMLButtonElement>('[data-close-site="kimi"]')!;
    assert.equal(close.getAttribute('aria-label'), copy.closeSitePage.replace('{site}', 'Kimi'));
    assert.match(close.dataset.hint!, new RegExp(copy.closeSitePage.split('{site}')[0].trim().slice(0, 2)));
    assert.notEqual(close.dataset.hint, close.getAttribute('aria-label'), 'tooltip explains unchecking is the way to only skip sending');
    assert.equal(close.querySelectorAll('svg path').length, 2, 'page-close glyph, not the plain dialog ✕');
    // The long participation explanation sits behind an info disclosure.
    const help = h.document.querySelector<HTMLButtonElement>('.drawer-info-toggle')!;
    const text = h.document.getElementById('participation-help')!;
    assert.equal(help.getAttribute('aria-expanded'), 'false');
    assert.equal(text.hidden, true);
    await h.click(help);
    assert.equal(help.getAttribute('aria-expanded'), 'true');
    assert.equal(text.hidden, false);
    assert.equal(text.textContent, copy.participationSessionHint);
  } finally { await h.close(); }
});

test('preset conflicts are named and only shown once a group name is typed', async () => {
  const copy = getCopy('zh-CN');
  const h = await mount('zh-CN', SITES.map(site => site.key));
  try {
    const hint = () => h.document.getElementById('group-save-hint')!.textContent;
    const save = h.document.querySelector<HTMLButtonElement>('.group-save button[type=submit]')!;
    assert.equal(hint(), '', 'no standing warning for the default "All" selection');
    assert.equal(save.dataset.hint, '当前选择与预设“全部”相同，无需另存');
    await h.input(h.document.querySelector<HTMLInputElement>('input[name="group-name"]')!, '常用');
    assert.equal(hint(), '当前选择与预设“全部”相同，无需另存');
    assert.equal(save.disabled, true);
  } finally { await h.close(); }
});

test('site names use a weight CJK fallback fonts provide', () => {
  const css = readSource('src/renderer/workspace.css');
  assert.match(css, /\.site-checklist label > span \{[^}]*font-weight: 500;/);
  assert.doesNotMatch(css, /font-weight: 550/);
});
