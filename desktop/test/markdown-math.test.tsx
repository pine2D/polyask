import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { MarkdownPreview } from '../src/renderer/markdown-preview';
import { mountTechnical, technicalButton, formulaSource, fractionMathml, type MathReply } from './ui/technical-reading-dom';

test('block math stays source-first and a user request renders real MathML nodes', async () => {
  const h = await mountTechnical('$$\n\\frac{1}{2}\n$$');
  try {
    assert.equal(h.document.querySelector('.markdown-math') !== null, true, 'a recognized formula has source and a preview control');
    assert.equal(formulaSource(h.document), '$$\n\\frac{1}{2}\n$$');
    assert.equal(h.document.querySelector('math') === null, true);
    assert.equal(h.jobs.length, 0);
    await h.click(technicalButton(h.document, 'Preview formula'));
    assert.equal(h.document.querySelector('math mfrac mn')?.textContent, '1');
    assert.equal(h.document.querySelectorAll('math mfrac mn').length, 2);
    assert.equal(h.document.querySelector('math annotation') === null, true, 'source annotation is not inserted as active content');
    assert.equal(formulaSource(h.document), '$$\n\\frac{1}{2}\n$$');
  } finally { await h.close(); }
});

test('bad math syntax falls back to exact literal source with an explicit explanation', async () => {
  const h = await mountTechnical('$$\n\\frac{\n$$');
  try {
    await h.click(technicalButton(h.document, 'Preview formula'));
    assert.equal(h.document.querySelector('math') === null, true);
    assert.equal(formulaSource(h.document), '$$\n\\frac{\n$$');
    assert.equal(h.document.querySelector('.markdown-math [role="status"]')?.textContent?.includes('Could not render') === true, true);
  } finally { await h.close(); }
});

test('a modest oversized formula is kept as source without starting expensive math work', async () => {
  const source = '$$\n' + 'x+'.repeat(2050) + '1\n$$';
  const h = await mountTechnical(source);
  try {
    assert.equal(formulaSource(h.document), source);
    assert.equal(h.document.querySelector('math') === null, true);
    assert.equal(h.document.querySelector('.markdown-math [role="status"]')?.textContent?.includes('preview limit') === true, true);
    assert.equal(h.jobs.length, 0);
  } finally { await h.close(); }
});

for (const source of ['\\href{https://evil.example}{x}', '\\htmlClass{evil}{x}', '\\gdef\\again{\\again}\\again']) {
  test('untrusted formula commands retain literal source: ' + source.split('{')[0], async () => {
    const value = '$$\n' + source + '\n$$';
    const h = await mountTechnical(value);
    try {
      assert.equal(h.document.querySelector('.markdown-math') !== null, true);
      const preview = [...h.document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Preview formula');
      if (preview && !preview.disabled) await h.click(preview);
      assert.equal(formulaSource(h.document), value);
      assert.equal(h.document.querySelector('math, .markdown-math a, .markdown-math img') === null, true);
      assert.equal(h.document.querySelector('.markdown-math [role="status"]')?.textContent?.length! > 0, true);
      assert.equal(h.jobs.length, 0);
    } finally { await h.close(); }
  });
}

test('malicious Worker output cannot become HTML, SVG or external MathML links', async () => {
  const h = await mountTechnical('$x$', { reply: () => ({ ok: true,
    mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow href="https://evil.example"><mi>x</mi><svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg></mrow></math>' }) });
  try {
    await h.click(technicalButton(h.document, 'Preview formula'));
    assert.equal(h.document.querySelector('script, svg, [href]') === null, true);
    assert.equal(h.document.querySelector('math') === null, true);
    assert.equal(formulaSource(h.document), '$x$');
    assert.equal(h.document.querySelector('.markdown-math [role="status"]')?.textContent?.length! > 0, true);
  } finally { await h.close(); }
});

test('currency, escaped dollars and inline code remain ordinary readable text', async () => {
  const h = await mountTechnical('Price $5 and $10. Escaped \\$x\\$. Inline `$x$`.');
  try {
    assert.equal(h.document.querySelector('.markdown-math') === null, true);
    assert.equal(h.document.querySelector('p')?.textContent, 'Price $5 and $10. Escaped $x$. Inline $x$.');
    assert.equal(h.jobs.length, 0);
  } finally { await h.close(); }
});

test('changing formula aborts old work and a late reply cannot replace the new formula', async () => {
  let oldReply!: (reply: MathReply) => void;
  const h = await mountTechnical('$x$', { reply: job => job.source === 'x' ? new Promise(resolve => { oldReply = resolve; }) :
    { ok: true, mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi></math>' } });
  try {
    await h.click(technicalButton(h.document, 'Preview formula'));
    await h.render(<MarkdownPreview value="$y$" />);
    await h.click(technicalButton(h.document, 'Preview formula'));
    assert.equal(h.document.querySelector('math')?.textContent, 'y');
    await act(async () => oldReply({ ok: true, mathml: fractionMathml }));
    assert.equal(h.document.querySelector('math')?.textContent, 'y');
    assert.equal(formulaSource(h.document), '$y$');
  } finally { await h.close(); }
});

test('a stalled Worker times out to source and leaves the preview control usable', async () => {
  const h = await mountTechnical('$x$', { reply: () => new Promise(() => {}) });
  try {
    await h.click(technicalButton(h.document, 'Preview formula'));
    assert.equal(technicalButton(h.document, 'Preview formula').disabled, true);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    assert.equal(technicalButton(h.document, 'Preview formula').disabled, false);
    assert.equal(h.document.querySelector('math') === null, true);
    assert.equal(formulaSource(h.document), '$x$');
    assert.equal(h.document.querySelector('.markdown-math [role="status"]')?.textContent?.includes('too long') === true, true);
  } finally { await h.close(); }
});

test('a second formula gets an explicit busy result and needs a manual retry', async () => {
  let firstReply!: (reply: MathReply) => void;
  const h = await mountTechnical('$x$ and $y$', { reply: job => job.source === 'x' ? new Promise(resolve => { firstReply = resolve; }) :
    { ok: true, mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>y</mi></math>' } });
  try {
    const previews = [...h.document.querySelectorAll<HTMLButtonElement>('button')].filter(node => node.textContent === 'Preview formula');
    assert.equal(previews.length, 2);
    await h.click(previews[0]); await h.click(previews[1]);
    assert.equal(h.jobs.length, 1);
    assert.equal(h.document.querySelectorAll('.markdown-math [role="status"]')[1].textContent?.includes('Another formula') === true, true);
    await act(async () => firstReply({ ok: true, mathml: fractionMathml }));
    assert.equal(h.jobs.length, 1, 'settling the first formula does not automatically replay the busy request');
    await h.click(previews[1]);
    assert.equal(h.jobs.length, 2);
    assert.equal(h.document.querySelectorAll('math')[1].textContent, 'y');
  } finally { await h.close(); }
});
