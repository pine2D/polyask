import assert from 'node:assert/strict';
import test from 'node:test';
import { useArchiveNavigation } from '../src/renderer/use-archive-navigation';
import { archiveCollectionActions } from '../src/renderer/archive-collection-actions';
import { getCopy } from '../src/shared/copy';
import { mountDom } from './ui/dom-harness';

test('collecting supplementary analysis opens its exact saved source in reading mode after a prior comparison', async () => {
  const navigations: Array<{ id?: string; mode?: string }> = [];
  function Fixture() {
    const navigation = useArchiveNavigation();
    const actions = archiveCollectionActions({ copy: getCopy('en'), capture: { capture: async () => { throw Error('must not collect live answers'); } },
      synthesis: { collect: async () => 'analysis-B' }, runAuxiliary: action => action(), announce: () => undefined,
      openArchive: (id?: string, mode?: string) => {
        navigations.push({ id, mode });
        if (id) navigation.history(id, mode === 'read' ? 'read' : 'compare'); else navigation.clear();
      } });
    return <><output>{navigation.preferredId}:{navigation.comparisonId}</output>
      <button name="prior" onClick={() => navigation.history('comparison-A', 'compare')}>Prior comparison</button>
      <button name="collect" onClick={() => { void actions.collectSynthesis(); }}>Collect analysis</button></>;
  }
  const h = await mountDom(<Fixture />);
  try {
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="prior"]')!);
    await h.click(h.document.querySelector<HTMLButtonElement>('[name="collect"]')!);
    assert.deepEqual(navigations, [{ id: 'analysis-B', mode: 'read' }]);
    assert.equal(h.document.querySelector('output')!.textContent, 'analysis-B:');
  } finally { await h.close(); }
});
