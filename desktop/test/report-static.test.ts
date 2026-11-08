import assert from 'node:assert/strict';
import test from 'node:test';
import { renderReportHtml } from '../src/main/report-template';
import { archiveFixture } from './fixtures';
const { JSDOM } = require('jsdom');

test('report renders shared formula tokens, leaving code and unsupported formulas readable', async () => {
  const archive = { ...archiveFixture(), results: [{ host: 'claude.ai', label: 'Claude', text: [
    '公式 $x^2$ 与 \\(y+1\\)', '$$\\frac{a}{b}$$', '`$code$`',
    '$\\href{https://evil.test}{bad}$', '<svg onload="alert(1)"></svg>',
    '![arbitrary](data:image/png;base64,AA==)', '```mermaid\ngraph TD; A-->B\n```'
  ].join('\n\n') }] };
  const collectMath = new Map();
  renderReportHtml({kind:'archive',archive},'zhCN',{collectMath});
  const { renderReportMath } = await import('../src/main/report-math');
  const math = await renderReportMath(collectMath,{signal:new AbortController().signal,guard:()=>{}});
  const dom = new JSDOM(renderReportHtml({ kind: 'archive', archive }, 'zhCN', {math}));
  try {
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('math').length, 3);
    assert.match(doc.body.textContent ?? '', /\\href\{https:\/\/evil.test\}/);
    assert.match(doc.body.textContent ?? '', /\$code\$/);
    assert.match(doc.body.textContent ?? '', /graph TD; A-->B/);
    assert.equal(doc.querySelectorAll('script,svg,img,[onload]').length, 0);
  } finally { dom.window.close(); }
});

test('generated visual allowance rejects SVG, URLs and oversized PNG headers before decode', async () => {
  const { validReportPng } = await import('../src/main/report-visuals');
  for (const value of ['file:///secret', 'https://evil.test/a.png', 'data:image/svg+xml,<svg/>',
    'data:image/png;base64,AA==', 'data:text/html;base64,AAAA']) assert.equal(validReportPng(value), false);
  const header = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a','hex').copy(header); header.write('IHDR',12);
  for (const [width,height] of [[4097,1],[1,4097],[4096,4096],[0,1]]) {
    header.writeUInt32BE(width,16); header.writeUInt32BE(height,20);
    assert.equal(validReportPng(`data:image/png;base64,${header.toString('base64')}`),false);
  }
});

test('diagram substitutions never enable source images or accept arbitrary SVG output', () => {
  const text = '```mermaid\ngraph TD; A-->B\n```\n\n![source](data:image/png;base64,AA==)';
  const archive = {...archiveFixture(),results:[{host:'claude.ai',label:'Claude',text}]};
  const html = renderReportHtml({kind:'archive',archive},'en',{diagrams:new Map([['graph TD; A-->B\n','data:image/svg+xml,<svg onload="bad"/>']])});
  assert.equal(html.includes('<img '),false);
  assert.match(html,/graph TD; A--&gt;B/);
});

test('dense formula reports cap work, yield for cancellation, and preserve over-limit source', async () => {
  const { renderReportMath, REPORT_MATH_LIMIT } = await import('../src/main/report-math');
  const archive={...archiveFixture(),results:[{host:'claude.ai',label:'Claude',text:Array.from({length:1000},(_,i)=>`$x_{${i}}$`).join(' ')}]};
  const collectMath=new Map();
  renderReportHtml({kind:'archive',archive},'en',{collectMath});
  assert.equal(collectMath.size,REPORT_MATH_LIMIT);
  const abort=new AbortController(); let guards=0;
  const pending=renderReportMath(collectMath,{signal:abort.signal,guard:()=>{guards++;}});
  setImmediate(()=>abort.abort());
  await assert.rejects(pending,/report_source_changed/);
  assert.equal(guards<10,true,'cancel is observed before completing the dense report');
  const math=await renderReportMath(collectMath,{signal:new AbortController().signal,guard:()=>{}});
  const html=renderReportHtml({kind:'archive',archive},'en',{math});
  assert.equal((html.match(/<math /g)||[]).length,REPORT_MATH_LIMIT);
  assert.equal(html.includes('$x_{999}$'),true);
});
