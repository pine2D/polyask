import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readSource } from './fixtures';

test('Alt+Q follows expansion alone, including the history sidebar and full reader', () => {
  const source = readSource('src/renderer/index.tsx');
  const command = source.slice(source.indexOf('    "focus-prompt": () => {'), source.indexOf("    'find-page': () => {"));
  const script = ts.transpileModule(`const actions = { ${command} }; actions['focus-prompt']();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  for (const expanded of [false, true]) for (const surface of ['sites', 'question-history']) for (const questionHistoryOpen of [false, true]) {
    const events: string[] = [];
    vm.runInNewContext(script, { surface, questionHistoryOpen,
      composer: { expanded, setExpanded: (value: boolean) => events.push(`expanded:${value}`) },
      focusCurrentSite: () => events.push('site'), activatePrompt: () => events.push('edit')
    });
    assert.deepEqual(events, expanded ? ['expanded:false', 'site'] : ['edit'], `${surface}, history=${questionHistoryOpen}, expanded=${expanded}`);
  }
});
