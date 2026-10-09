import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { readSource } from './fixtures';

const { JSDOM } = require('jsdom') as { JSDOM: new (html: string, options?: { url: string }) => { window: Window & typeof globalThis } };

const base = 'https://source.example/notice.html';
const longUrl = base + '#:~:text=' + '%E6%A0%B9'.repeat(100);
const render = (value: string) => renderToStaticMarkup(<MarkdownPreview value={value} onOpenLink={() => undefined} />);
function compact(html: string, destination: string, visible = 'source.example/notice.html') {
  const dom = new JSDOM(html);
  try {
    const link = dom.window.document.querySelector('a');
    assert.equal(link?.textContent, visible);
    assert.equal(link?.getAttribute('href'), destination);
    assert.equal(link?.getAttribute('title'), destination);
    assert.equal(dom.window.document.querySelectorAll('.markdown-link-details').length, 1);
  } finally { dom.window.close(); }
}

for (const [name, label] of [
  ['bold', `**${longUrl}**`], ['italic', `*${longUrl}*`], ['strike', `~~${longUrl}~~`],
  ['inline code', '`' + longUrl + '`'], ['nested style', `***${longUrl}***`],
  ['soft break', longUrl.slice(0, 90) + '\n' + longUrl.slice(90)],
  ['hard break', longUrl.slice(0, 90) + '  \n' + longUrl.slice(90)],
  ['nonbreaking space', '\u00a0' + longUrl + '\u00a0']
]) test(`${name} URL labels compact while retaining the exact target`, () => {
  compact(render(`[${label}](${longUrl})`), longUrl);
});

for (const [name, label, target, visible] of [
  ['label-only text fragment', longUrl, base, 'source.example/notice.html'],
  ['target-only text fragment', base, longUrl, 'source.example/notice.html'],
  ['different target host', longUrl, 'https://actual.example/notice.html', 'actual.example/notice.html'],
  ['percent escape case', longUrl.toLowerCase(), longUrl, 'source.example/notice.html'],
  ['short label fragment', 'https://label.example/#:~:text=x', base, 'source.example/notice.html'],
  ['scheme-free domain', 'source.example.com/notice.html?query=' + 'x'.repeat(100), longUrl, 'source.example/notice.html']
]) test(`${name} does not bypass readable URL labels`, () => {
  compact(render(`[${label}](${target})`), target, visible);
});

for (const [name, label, text] of [
  ['bold title', '**官方答复**', '官方答复'], ['code title', '`官方答复`', '官方答复'],
  ['multiline title', '官方\n答复', '官方\n答复'],
  ['URL with caption', base + ' 官方资料', base + ' 官方资料'],
  ['filename title', 'official-report.docx', 'official-report.docx'],
  ['other protocol label', 'file:///report/' + 'x'.repeat(100), 'file:///report/' + 'x'.repeat(100)]
]) test(`${name} survives a long destination`, () => {
  const dom = new JSDOM(render(`[${label}](${longUrl})`));
  try {
    assert.equal(dom.window.document.querySelector('a')?.textContent, text);
    assert.equal(dom.window.document.querySelector('a')?.getAttribute('href'), longUrl);
    assert.equal(dom.window.document.querySelectorAll('.markdown-link-details').length, 0);
  } finally { dom.window.close(); }
});

test('a scheme-free long URL captured as plain text also gets a compact link', () => {
  const label = 'source.example.com/notice.html?query=' + 'x'.repeat(100);
  compact(render(label), 'http://' + label, 'source.example.com/notice.html');
});

for (const kind of ['styled', 'code', 'different target']) test(`captured Kimi-shaped ${kind} links use the shared compact reader`, () => {
  const dom = new JSDOM('<div class="chat-content-item-assistant"><p><a></a></p></div>', { url: 'https://www.kimi.com/chat/local' });
  try {
    const destination = kind === 'different target' ? base : longUrl;
    const a = dom.window.document.querySelector('a')!;
    a.setAttribute('href', destination);
    const label = dom.window.document.createElement(kind === 'styled' ? 'strong' : kind === 'code' ? 'code' : 'span');
    label.textContent = longUrl; a.append(label);
    const runtime: { toMarkdown?: (node: Element) => string } = {};
    const context = vm.createContext({ window: { __AMS: runtime }, document: dom.window.document, location: dom.window.location,
      URL, NodeFilter: dom.window.NodeFilter, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) });
    for (const file of ['md-head.js', 'md.js']) vm.runInContext(readSource('src/site-runtime/' + file), context);
    const markdown = runtime.toMarkdown!(dom.window.document.querySelector('.chat-content-item-assistant')!);
    assert.equal(markdown.includes(longUrl), true, 'capture keeps the complete visible URL');
    compact(render(markdown), destination);
  } finally { dom.window.close(); }
});

test('standalone inline and fenced URL code stays verbatim', () => {
  const dom = new JSDOM(render('`' + longUrl + '`\n\n```txt\n' + longUrl + '\n```'));
  try {
    assert.deepEqual([...dom.window.document.querySelectorAll('code')].map(node => node.textContent), [longUrl, longUrl]);
    assert.equal(dom.window.document.querySelectorAll('a, .markdown-link-details').length, 0);
  } finally { dom.window.close(); }
});
