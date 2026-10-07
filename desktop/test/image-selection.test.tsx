import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { useImageSelection } from '../src/renderer/use-image-selection';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

async function selection() {
  let flow!: ReturnType<typeof useImageSelection>;
  const notices: string[] = [];
  function Fixture() { flow = useImageSelection(getCopy('en'), true, value => notices.push(value)); return <span>{flow.images.length}</span>; }
  const h = await mountDom(<Fixture />);
  const file = (name: string, size = 8) => {
    const bytes = new Uint8Array(size); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    return new h.window.File([bytes], name, { type: 'image/png' }) as File;
  };
  const choose = async (files: File[], mode?: 'append' | 'replace') => { await act(async () => { await flow.choose(files, mode); }); };
  return { ...h, flow: () => flow, file, choose, notices };
}

test('pasting another batch appends while explicit replacement keeps its original meaning', async () => {
  const h = await selection();
  try {
    await h.choose([h.file('first.png')]);
    await h.choose([h.file('second.png')], 'append');
    assert.deepEqual(h.flow().images.map(image => image.name), ['first.png', 'second.png']);
    assert.equal(h.notices.at(-1), getCopy('en').imagesReady.replace('{count}', '2'));
    await h.choose([h.file('replacement.png')], 'replace');
    assert.deepEqual(h.flow().images.map(image => image.name), ['replacement.png']);
  } finally { await h.close(); }
});

test('append validates the combined four-image limit without losing existing attachments', async () => {
  const h = await selection();
  try {
    await h.choose([1, 2, 3, 4].map(n => h.file(`${n}.png`)));
    await h.choose([h.file('fifth.png')], 'append');
    assert.deepEqual(h.flow().images.map(image => image.name), ['1.png', '2.png', '3.png', '4.png']);
    assert.equal(h.flow().error, getCopy('en').imageCountError);
  } finally { await h.close(); }
});

test('append enforces combined ten-MiB total and retains the previous batch on failure', async () => {
  const h = await selection();
  try {
    await h.choose([h.file('six.png', 6 * 1024 * 1024)]);
    await h.choose([h.file('five.png', 5 * 1024 * 1024)], 'append');
    assert.deepEqual(h.flow().images.map(image => image.name), ['six.png']);
    assert.equal(h.flow().error, getCopy('en').imageSizeError);
  } finally { await h.close(); }
});

test('two rapid pasted batches keep both additions in input order', async () => {
  const h = await selection();
  try {
    await h.choose([h.file('first.png')]);
    await act(async () => {
      await Promise.all([
        h.flow().choose([h.file('second.png')], 'append'),
        h.flow().choose([h.file('third.png')], 'append')
      ]);
    });
    assert.deepEqual(h.flow().images.map(image => image.name), ['first.png', 'second.png', 'third.png']);
  } finally { await h.close(); }
});

test('clearing attachments invalidates in-flight and queued pasted files', async () => {
  const h = await selection();
  try {
    await act(async () => {
      const pending = [
        h.flow().choose([h.file('first.png')], 'append'),
        h.flow().choose([h.file('second.png')], 'append')
      ];
      h.flow().clear();
      await Promise.all(pending);
    });
    assert.deepEqual(h.flow().images, []);
  } finally { await h.close(); }
});
