// Mixed bounded records: only 12 archives have 9 x 32KiB answers; all others have one short answer.
exports.seed = (db, services, count, createArchiveRecord) => {
  let sourceBytes = 0, maxRecordBytes = 0, longCount = 0;
  const words = ['农业', 'Evidence', '100%_', 'İSTANBUL', '普通'];
  const folder = services.folders.create('Synthetic project');
  const first = createArchiveRecord({ text: 'seed', results: [] }, { id: 'seed', now: 1, deviceId: 'baseline' });
  db.archives.put(first, false);
  const card = services.decisions.create({ archiveId: 'seed', sourceUpdatedAt: 1, title: 'seed', conclusion: '', rationale: '',
    uncertainties: '', nextStep: '', status: 'draft', evidence: [] });
  // Remove seed-only rows before measured data; this is a disposable synthetic fixture, never production data.
  db.database.prepare('DELETE FROM archives').run(); db.database.prepare('DELETE FROM decisions').run();
  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const kind = i % 2 === 0 ? 'archive' : 'decision', id = `record-${String(i).padStart(5, '0')}`;
      const word = words[i % words.length], title = `${word} ${count - i}`;
      let record;
      if (kind === 'archive') {
        const long = i < 24;
        if (long) longCount++;
        record = createArchiveRecord({ text: title, task: title,
          results: Array.from({ length: long ? 9 : 1 }, (_, j) => ({ host: `source${j}.example`, label: `Source ${j}`,
            text: long ? `${word} LONG_BODY ` + 'x'.repeat(32768) : `${word} bounded answer ${i}` })) },
        { id, now: i + 1, deviceId: 'baseline' });
        db.archives.put(record, false);
      } else {
        record = { ...card, id, title, createdAt: i + 1, updatedAt: i + 1, sourceTitle: word, archiveId: 'record-00000',
          evidence: [{ id: `evidence-${i}`, resultIndex: 0, label: 'Source 0', host: 'source0.example', capturedAt: 1, topic: word, excerpt: `${word} evidence` }] };
        db.decisions.put(record, false);
      }
      const bytes = Buffer.byteLength(JSON.stringify(record)); sourceBytes += bytes; maxRecordBytes = Math.max(maxRecordBytes, bytes);
      if (i % 4 === 0) db.folders.putMembership({ id: `${folder.id.length}:${folder.id}:${kind}:${id}`, folderId: folder.id,
        targetKind: kind, targetId: id, createdAt: 1, updatedAt: 1, deviceId: 'baseline', schema: 3 }, false);
    }
  });
  return { count, sourceBytes, maxRecordBytes, longArchives: longCount, longAnswersPerArchive: 9,
    answerBodyBytes: 32768, folderId: folder.id, archiveCount: count / 2, decisionCount: count / 2 };
};
exports.cases = (count, folderId) => [
  { name: 'date-page', request: { page: 2 } },
  ...['农业', 'Evidence', '100%_', 'i̇stanbul'].map(query => ({ name: `search-${query}`, request: { query } })),
  { name: 'folder', request: { folderId } },
  { name: 'long-answer-summary', request: { sort: 'created-desc', page: count / 100 - 1 } },
  { name: 'title-selected', request: { sort: 'title-asc', locale: 'zhCN', selected: { kind: 'archive', id: 'record-00000' },
    locateSelected: true, selectedTargets: [{ kind: 'archive', id: 'record-00000' }, { kind: 'decision', id: 'record-00001' }] } },
];
