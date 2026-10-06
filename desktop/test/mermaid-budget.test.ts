import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagram } from '../src/renderer/mermaid-renderer';
test('dense single-line graphs fail before importing Mermaid or accessing browser DOM', async () => {
  const source = 'flowchart LR\n' + Array.from({ length: 3000 }, (_, i) => 'N' + i).join(';');
  assert.ok(source.length < 20000 && source.split('\n').length < 600);
  await assert.rejects(renderDiagram(source, false), { message: 'diagram_limit' });
});
test('departed queued diagrams skip browser work', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderDiagram('flowchart LR\n A --> B', false, controller.signal), { message: 'diagram_cancelled' });
});
