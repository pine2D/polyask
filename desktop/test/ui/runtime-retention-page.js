// Loaded only into the isolated world of locally served native-test pages.
(function () {
  const S = window.__AMS, claude = location.hostname === 'claude.ai';
  const realTimeout = window.setTimeout.bind(window);
  const adapter = S.adapters[location.hostname];
  let now = Date.now(), serial = 0;
  const timers = new Map();
  Date.now = () => now;
  window.setTimeout = (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; };
  window.clearTimeout = id => timers.delete(id);
  function turn(id, question, answer) {
    return claude
      ? `<div data-turn-key="u-${id}"><div data-testid="user-message">${question}</div></div>
        <div data-turn-key="a-${id}"><div data-testid="assistant-message"><div data-perf-reply-text>${answer}</div></div></div>`
      : `<section data-turn="user" data-content-search-unit-key="u-${id}"><div data-message-author-role="user">${question}</div></section>
        <section data-turn="assistant" data-content-search-unit-key="a-${id}"><div data-message-author-role="assistant"><div class="markdown">${answer}</div></div></section>`;
  }
  const original = turn('old', 'Earlier question', 'Earlier answer');
  const fresh = turn('new', 'Synthetic question', 'Synthetic answer');
  document.body.innerHTML = `<style>#stop.off{display:none}</style><main id="turns">${original}</main><div contenteditable="true" role="textbox" style="position:fixed;top:600px;width:300px;height:30px"></div>
    <button id="stop" class="off" data-testid="${claude ? 'chat-input-stop' : 'stop-button'}" style="position:fixed;top:640px">Stop</button>
    <button id="action" style="position:fixed;left:10px;top:700px;width:100px;height:30px">Action</button>`;
  window.retention = {
    nodes: [],
    checkpoint() { return new Promise(resolve => requestAnimationFrame(() => realTimeout(resolve, 0))); },
    control: new WeakRef({}), detachedControl: new WeakRef(document.createElement('aside')),
    answerText() { return adapter.answer()?.textContent; },
    track() { this.nodes = [...document.querySelectorAll('#turns, #turns *')].map(node => new WeakRef(node)); },
    appendTurn() { document.getElementById('turns').insertAdjacentHTML('beforeend', fresh); },
    replaceTurn() { document.getElementById('turns').outerHTML = `<main id="turns">${fresh}</main>`; },
    showStop(shown) { document.getElementById('stop').classList.toggle('off', !shown); },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
}());
