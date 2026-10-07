import React from 'react';
import { createRoot } from 'react-dom/client';
import { QuestionHistoryReader } from '../../src/renderer/question-history-reader';
import { MarkdownPreview } from '../../src/renderer/markdown-preview';
import { getCopy } from '../../src/shared/copy';
import { setShellApi } from '../../src/renderer/shell-api';
import { readingDetail, diagramSource, longSourceUrl } from './reading-data';
import '../../src/renderer/styles.css';
import '../../src/renderer/question-history.css';
const locale = new URLSearchParams(location.search).get('locale') ?? 'zh-CN';
document.documentElement.lang = locale;
const copy = getCopy(locale), clipboard: string[] = [], opened: string[] = [], notices: string[] = [];
const restored: (string | undefined)[] = [];
let reasked = 0, deleted = 0;
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { clipboard.push(text); } } });
setShellApi({ openExternal: async (url: string) => { opened.push(url); } } as any);
const root = createRoot(document.getElementById('root')!);
let extra = 'flowchart LR\n Old --> Gone';
const render = () => root.render(<section className="question-history is-full">
  <QuestionHistoryReader detail={readingDetail} copy={copy} sites={[]} busy={false} onRestore={id => restored.push(id)}
    onReask={() => { reasked++; }} onDelete={() => { deleted++; }} onAnnounce={text => notices.push(text)} />
  <div id="diagram-cases"><MarkdownPreview value={'```mermaid\n' + extra + '\n```'} /></div>
</section>);
render();
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function until(checker: () => unknown) {
  const deadline = Date.now() + 15000;
  while (!checker()) { check(Date.now() < deadline, 'UI timeout: ' + (document.querySelector('.mermaid-notice')?.textContent ?? 'no notice')); await pause(); }
}
const click = async (selector: string) => { const node = document.querySelector<HTMLButtonElement>(selector); check(node, `missing ${selector}`); node.click(); await pause(); };
const label = (text: string) => `button[aria-label="${text}"]`;
const setSource = async (source: string) => { extra = source; render(); await pause(); };
const cases = () => document.querySelector('#diagram-cases')!;
function toolbarLayout() {
  const toolbar = document.querySelector<HTMLElement>('.question-reader-actions')!;
  const answer = toolbar.querySelector<HTMLElement>('.question-answer-actions')!.getBoundingClientRect();
  const question = toolbar.querySelector<HTMLElement>('.question-prompt-actions')!.getBoundingClientRect();
  check(!document.querySelector('.question-reader-intro button'), 'no duplicate heading actions');
  if (window.innerWidth >= 900) check(Math.abs(answer.top - question.top) <= 1, 'wide toolbar stays on one row');
  check(answer.right <= question.left + 1 || question.top >= answer.bottom, 'action groups never overlap');
  for (const node of toolbar.querySelectorAll<HTMLElement>('button')) {
    const rect = node.getBoundingClientRect();
    check(rect.height >= 32 && rect.width >= 32, 'toolbar controls keep their click targets');
    check(rect.left >= 0 && rect.right <= window.innerWidth, 'toolbar control stays within the viewport');
  }
  check(document.querySelector('.question-reader')!.scrollWidth <= document.querySelector('.question-reader')!.clientWidth + 1, 'toolbar does not cause horizontal overflow');
  return { ok: true, width: window.innerWidth, wrapped: question.top > answer.top + 1 };
}
(window as any).historyToolbarLayout = toolbarLayout;
async function run() {
  await until(() => document.querySelector('.question-answer .mermaid-canvas img'));
  const image = document.querySelector<HTMLImageElement>('.question-answer .mermaid-canvas img')!;
  await until(() => image.complete && image.naturalWidth > 0);
  check(image.src.startsWith('data:image/svg+xml'), 'diagram must be a local image');
  const svg = decodeURIComponent(image.src.split(',').slice(1).join(','));
  check(svg.includes('开始') && svg.includes('保存'), 'source labels must actually render');
  check(!svg.includes('<foreignObject') && !svg.includes('<script'), 'image contains no active HTML');
  await click('.question-answer ' + label(copy.readingCopySource));
  check(clipboard.at(-1) === diagramSource, 'diagram copy is exact source');
  await click('.question-answer .mermaid-tabs button:last-child');
  check(document.querySelector('.question-answer .mermaid-preview pre')?.textContent === diagramSource, 'code tab preserves source');
  check(getComputedStyle(document.querySelector('.question-answer .mermaid-preview pre')!).color === getComputedStyle(document.querySelector('.question-reader')!).color, 'diagram source inherits readable theme text');
  await click('.question-answer .mermaid-tabs button:first-child');
  await click('.question-answer ' + label(copy.readingZoomIn));
  check(document.querySelector<HTMLElement>('.question-answer .mermaid-canvas img')!.style.width === '125%', 'zoom changes image size');
  await click('.question-answer ' + label(copy.readingZoomReset));
  check(document.querySelector<HTMLElement>('.question-answer .mermaid-canvas img')!.style.width === '100%', 'fit resets zoom');
  const link = document.querySelector<HTMLAnchorElement>('.markdown-link-group a')!;
  check(link.textContent === 'poe2db.tw/cn/Rune' && link.href === longSourceUrl, 'compact label preserves full destination');
  link.click(); await pause(); check(opened.at(-1) === longSourceUrl, 'opening uses full URL');
  await click('.markdown-link-details');
  await click('.markdown-link-popover button'); check(clipboard.at(-1) === longSourceUrl, 'link copy keeps text fragment');
  document.querySelector('.markdown-link-details')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  check(!document.querySelector('.markdown-link-popover'), 'Escape closes full-link details');
  await click(label(copy.questionCopyLink)); check(clipboard.at(-1)?.endsWith('/second'), 'conversation copy uses current attempt');
  await click(label(copy.questionOpenBrowser)); check(opened.at(-1)?.endsWith('/second'), 'browser action uses current attempt');
  await click(label(copy.questionCopy)); check(clipboard.at(-1) === readingDetail.answers[1].answerMarkdown, 'copy icon keeps the complete current answer');
  check(document.querySelector(label(copy.questionCopy))?.textContent === '', 'copy answer has no visible text');
  await click('.question-restore-split > button'); check(restored.at(-1) === 'a2', 'primary restores the current attempt');
  await click(label(copy.questionRestoreOptions));
  check(document.activeElement?.textContent === copy.questionRestoreAll, 'menu focuses its first action');
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!.getBoundingClientRect();
  check(menu.left >= 0 && menu.right <= window.innerWidth, 'restore menu stays within viewport');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pause();
  check(!document.querySelector('[role="menu"]') && document.activeElement === document.querySelector(label(copy.questionRestoreOptions)), 'Escape returns focus to the trigger');
  await click(label(copy.questionRestoreOptions)); await click('[role="menu"] button');
  check(restored.at(-1) === undefined && restored.length === 2, 'dropdown restores the entire question');
  await click('.question-prompt-actions > button'); check(reasked === 1, 'reuse question remains separate');
  await click(label(copy.questionMenu)); await click('[role="menu"] button');
  check(deleted === 1 && !document.querySelector('[role="menu"]'), 'delete delegates to the question confirmation and closes the menu');
  toolbarLayout();
  await setSource('this is not a diagram');
  await until(() => cases().querySelector('.mermaid-notice')?.textContent === copy.readingDiagramFailed);
  check(cases().querySelector('pre')?.textContent === 'this is not a diagram', 'invalid syntax retains source');
  await setSource('flowchart LR\n' + 'A --> B\n'.repeat(3000));
  await until(() => cases().querySelector('.mermaid-notice')?.textContent === copy.readingDiagramLimit);
  await setSource('flowchart LR\n' + Array.from({ length: 3000 }, (_, i) => 'N' + i).join(';'));
  await until(() => cases().querySelector('.mermaid-notice')?.textContent === copy.readingDiagramLimit);
  await setSource('%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\nA --> B');
  await until(() => cases().querySelector('.mermaid-notice')?.textContent === copy.readingDiagramFailed);
  await setSource('');
  check(cases().querySelector('.mermaid-notice')?.textContent === copy.readingDiagramMissing, 'missing source is explicit');
  extra = 'flowchart LR\n Stale --> Label'; render();
  extra = 'flowchart LR\n Current --> Label'; render();
  await until(() => cases().querySelector('img'));
  const latest = decodeURIComponent(cases().querySelector<HTMLImageElement>('img')!.src.split(',').slice(1).join(','));
  check(latest.includes('Current') && !latest.includes('Stale'), 'departed render cannot replace current source');
  check(document.querySelector('.question-reader')!.scrollWidth <= document.querySelector('.question-reader')!.clientWidth + 1, 'reading content stays within its scroller');
  return { ok: true, locale, diagramWidth: image.naturalWidth };
}
(window as any).readingResult = run().catch(error => ({ ok: false, locale, error: String(error) }));
