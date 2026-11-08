// Deliberately small vanilla DOM consumer, not a React/rendering benchmark.
window.consume = async request => {
  const start = performance.now();
  const { value, trace } = await window.baselineQuery(request);
  const roundtripMs = performance.now() - start, consumeStart = performance.now();
  const list = document.querySelector('ul');
  list.replaceChildren(...value.items.map(item => {
    const li = document.createElement('li'); li.textContent = item.record.task ?? item.record.title; return li;
  }));
  const consumerMs = performance.now() - consumeStart;
  return { ...trace, roundtripMs, consumerMs, bytes: new TextEncoder().encode(JSON.stringify(value)).length,
    total: value.total, page: value.page, selectedPage: value.selectedPage, selected: value.selected,
    selectedTargets: value.selectedTargets, ids: value.items.map(item => item.kind + ':' + item.record.id),
    projectedBodies: value.items.some(item => 'text' in item.record || 'searchText' in item.record ||
      item.record.results?.some(result => 'text' in result)), domItems: list.children.length };
};
