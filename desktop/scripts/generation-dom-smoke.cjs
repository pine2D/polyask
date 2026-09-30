// Real Chromium selectors against synthetic markup; no accounts, network or sends.
const { app, BrowserWindow, session, protocol } = require('electron');
const { mkdtempSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'polyask-generation-dom-')));
const source = file => readFileSync(join(__dirname, '../src/site-runtime', file), 'utf8');
let win, exitCode = 0;
const watchdog = setTimeout(() => { console.error('generation DOM smoke timed out'); app.exit(1); }, 30000);
const page = '<!doctype html><style>textarea{position:absolute;top:200px}button,.ds-button--primary,.send-button-container{display:block;width:40px;height:40px}</style><textarea></textarea><div id="turns"></div>';
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (_d, cb) => cb({ cancel: true }));
  protocol.handle('https', () => new Response(page, { headers: { 'Content-Type': 'text/html' } }));
  win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  await win.loadURL('https://chatgpt.com/c/fixture');
  await evaluate(source('core.js'));
  assert.equal(await evaluate(`(()=>{const answer=document.createElement('div');answer.setAttribute('data-chatgpt-selection-message-id','canvas');answer.innerHTML='<div contenteditable="true" style="width:384px;height:3252px">Synthetic answer</div>';document.body.append(answer);const ok=window.__AMS.findComposer()===document.querySelector('textarea');answer.remove();return ok;})()`), true);
  await evaluate(`window.__AMS={adapters:{},toMarkdown:n=>n.textContent,findComposer:()=>document.querySelector('textarea')};void 0;`);
  for (const file of ['adapters-intl2.js', 'generation.js', 'history-adapters.js', 'history.js']) await evaluate(source(file));
  const results = await evaluate(`(async()=>{
    const S=window.__AMS,a=S.adapters['chatgpt.com'],turns=document.querySelector('#turns');
    const user=t=>'<div data-user-message-bubble>'+t+'</div>';
    const answer=(id,t)=>'<div data-content-search-unit-key="'+id+'"><h4 data-conversation-role="assistant">Assistant</h4><div data-chatgpt-selection-message-id="'+id+'"><div data-markdown-text-style="assistant-message">'+t+'</div></div></div>';
    turns.innerHTML=user('Old question')+answer('old','Old answer');
    S.history.begin('current','New question');
    turns.insertAdjacentHTML('beforeend',user('New question'));
    await new Promise(r=>setTimeout(r,0));
    const oldRejected=a.historyTurn().answer===null&&S.history.snapshot('current').text===undefined;
    turns.insertAdjacentHTML('beforeend','<div data-content-search-unit-key="thinking"><h4 data-conversation-role="assistant">Assistant</h4><div data-markdown-text-style="thought">Reasoning</div></div>');
    const thoughtExcluded=a.historyTurn().answer===null&&S.history.snapshot('current').text===undefined;
    turns.insertAdjacentHTML('beforeend',answer('new','New answer'));
    const turn=a.historyTurn(),snapshot=S.history.snapshot('current');
    const current={text:turn.text,count:turn.userCount,answer:a.answer().textContent,key:turn.answerKey,root:turn.answerRoot.getAttribute('data-content-search-unit-key'),owned:snapshot.owned,captured:snapshot.text};
    const root=turn.answerRoot;
    root.querySelector('[data-markdown-text-style="assistant-message"]').outerHTML='<div data-markdown-text-style="assistant-message">Updated answer</div>';
    const replacement=S.history.snapshot('current').text==='Updated answer'&&a.historyTurn().answerKey==='new';
    turns.insertAdjacentHTML('beforeend',user('Manual follow-up'));
    const followupRejected=!S.history.snapshot('current').owned;
    const legacy=document.createElement('section');legacy.dataset.turn='user';legacy.innerHTML=user('Question')+'<button>Copy</button>';turns.replaceChildren(legacy);
    const dedup={count:a.historyTurn().userCount,text:a.historyTurn().text};
    return {oldRejected,thoughtExcluded,current,replacement,followupRejected,dedup};
  })()`);
  assert.deepEqual(results, { oldRejected: true, thoughtExcluded: true, current: { text: 'New question', count: 2, answer: 'New answer', key: 'new', root: 'new', owned: true, captured: 'New answer' }, replacement: true, followupRejected: true, dedup: { count: 1, text: 'Question' } });
  await win.loadURL('https://chatgpt.com/');
  await evaluate(`window.__AMS={adapters:{},toMarkdown:n=>n.textContent};void 0;`);
  for (const file of ['adapters-intl2.js', 'history-adapters.js', 'history.js']) await evaluate(source(file));
  const settlement = await evaluate(`(async()=>{
    const S=window.__AMS,turns=document.querySelector('#turns');
    S.history.begin('settling','Synthetic question');
    history.pushState({},'', '/c/local-chatgpt%3A01234567-89ab-cdef-0123-456789abcdef');
    turns.innerHTML='<div data-user-message-bubble>Synthetic question</div>';
    await new Promise(r=>setTimeout(r,0));
    const bound=S.history.snapshot('settling').owned;
    history.replaceState({},'', '/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    turns.insertAdjacentHTML('beforeend','<div data-content-search-unit-key="new"><h4 data-conversation-role="assistant">Assistant</h4><div data-chatgpt-selection-message-id="new"><div data-markdown-text-style="assistant-message">Saved answer</div></div></div>');
    const snapshot=S.history.snapshot('settling');
    history.pushState({},'', '/c/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee');
    return {bound,owned:snapshot.owned,text:snapshot.text,otherRejected:!S.history.snapshot('settling').owned};
  })()`);
  assert.deepEqual(settlement, { bound: true, owned: true, text: 'Saved answer', otherRejected: true });
  await win.loadURL('https://chatgpt.com/c/streaming');
  await evaluate(`window.__AMS={adapters:{},toMarkdown:n=>n.textContent};void 0;`);
  for (const file of ['adapters-intl2.js', 'history-adapters.js', 'history.js']) await evaluate(source(file));
  const wrapping = await evaluate(`(async()=>{
    const S=window.__AMS,turns=document.querySelector('#turns');
    S.history.begin('wrapping','Question');
    turns.innerHTML='<div data-user-message-bubble>Question</div><div data-content-search-unit-key="stream"><h4 data-conversation-role="assistant">Assistant</h4><div data-markdown-text-style="assistant-message">First token</div></div>';
    await new Promise(r=>setTimeout(r,0));
    const first=S.history.snapshot('wrapping').text;
    const markdown=S.adapters['chatgpt.com'].answer(),wrapper=document.createElement('div');
    wrapper.setAttribute('data-chatgpt-selection-message-id','server-message');
    markdown.before(wrapper);wrapper.append(markdown);markdown.textContent='Full streaming answer';
    const snapshot=S.history.snapshot('wrapping');
    return {first,owned:snapshot.owned,text:snapshot.text};
  })()`);
  assert.deepEqual(wrapping, { first: 'First token', owned: true, text: 'Full streaming answer' });
  const controls = [
    ['chatgpt.com', '<button aria-label="Stop"></button>', '<button aria-label="Send"></button>'],
    ['www.doubao.com', '<div class="break-btn-fixture" style="width:40px;height:40px"></div>', '<button id="flow-end-msg-send"></button>'],
    ['kimi.com', '<div class="send-button-container stop"></div>', '<div class="send-button-container"></div>'],
    ['yuanbao.tencent.com', '<div id="yuanbao-send-btn" aria-label="Stop Answering" style="width:40px;height:40px"></div>', '<div id="yuanbao-send-btn" aria-label="Send"></div>'],
    ['deepseek.com', '<div class="ds-button--primary"><svg><path d="M2 4.88C2 3.68009 2 3.08013 2.30557 2.65954"></path></svg></div>', '<div class="ds-button--primary"><svg><path d="M8.3125 0.980206C8.66767 1.05312"></path></svg></div>'],
  ];
  for (const [host, stop, send] of controls) {
    await win.loadURL('https://' + host + '/');
    await evaluate(`window.__AMS={adapters:{[location.hostname.replace('www.','')]:{answer:()=>null}},findComposer:()=>document.querySelector('textarea')};void 0;`);
    await evaluate(source('generation.js'));
    for (const [html, expected] of [[stop, 'generating'], [send, 'idle']]) {
      assert.equal(await evaluate(`document.querySelector('#turns').innerHTML=${JSON.stringify(html)};Object.values(window.__AMS.adapters)[0].generation()`), expected, host);
    }
  }
  console.log('generation DOM smoke passed: real selectors, stop/send distinction, owned ChatGPT answers and provisional route settlement');
}).catch(error => { console.error(error); exitCode = 1; }).finally(() => {
  if (win && !win.isDestroyed()) win.destroy();
  clearTimeout(watchdog);
  app.exit(exitCode);
});
