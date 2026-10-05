const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup(host = "example.test", href = `https://${host}/chat/one`) {
  let turn = null, mutated = () => {}, now = 1000, slots = 0;
  // Navigation API 只建模 currentEntry.key 的槽位语义：push 换槽、replace 留槽（history-route.js 据此区分豆包 local_ 的 replace 与侧栏 push）。
  const navigation = { currentEntry: { key: "slot-0" } };
  const contexts = [];
  const listeners = new Map();
  const events = { addEventListener: (name, f) => listeners.set(name, f), removeEventListener: name => listeners.delete(name) };
  const adapter = { historyTurn: ctx => { contexts.push(ctx); return turn; }, generation: () => "generating" };
  const S = { adapters: { [host]: adapter }, toMarkdown: node => node.text };
  const context = { URL, getComputedStyle: node => ({ cursor: node.cursor || "auto" }), Date: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {}, document: { ...events, documentElement: {} }, MutationObserver: class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} }, window: { ...events, __AMS: S, navigation }, location: { hostname: host, href } };
  for (const file of ["history-route.js", "history.js"]) vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../src/site-runtime", file), "utf8"), context);
  return { S, contexts, customActivate: cursor => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ nodeType: 1, cursor, matches: () => false }] }), activate: () => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ matches: () => true }] }),
    input: () => listeners.get('beforeinput')?.({type:'beforeinput',isTrusted:true}), navigate: (href, { replace = false } = {}) => { context.location.href = href; if (!replace) navigation.currentEntry = { key: `slot-${++slots}` }; },
    dropNavigation: () => { delete context.window.navigation; }, popstate: () => listeners.get('popstate')?.({}), advance: ms => { now += ms; }, set: value => { turn = value; }, insert: value => { turn = value; mutated([{ addedNodes: [value.user] }]); }, mutate: records => mutated(records) };
}
const node = (text) => ({ text, isConnected: true });
module.exports = { setup, node };
