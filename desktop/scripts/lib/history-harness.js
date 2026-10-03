const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup(host = "example.test", href = `https://${host}/chat/one`) {
  let turn = null, mutated = () => {}, now = 1000;
  const contexts = [];
  const listeners = new Map();
  const events = { addEventListener: (name, f) => listeners.set(name, f), removeEventListener: name => listeners.delete(name) };
  const adapter = { historyTurn: ctx => { contexts.push(ctx); return turn; }, generation: () => "generating" };
  const S = { adapters: { [host]: adapter }, toMarkdown: node => node.text };
  const context = { URL, getComputedStyle: node => ({ cursor: node.cursor || "auto" }), Date: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {}, document: { ...events, documentElement: {} }, MutationObserver: class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} }, window: { ...events, __AMS: S }, location: { hostname: host, href } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../src/site-runtime/history.js"), "utf8"), context);
  return { S, contexts, customActivate: cursor => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ nodeType: 1, cursor, matches: () => false }] }), activate: () => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ matches: () => true }] }),
    input: () => listeners.get('beforeinput')?.({type:'beforeinput',isTrusted:true}), navigate: href => { context.location.href = href; }, popstate: () => listeners.get('popstate')?.({}), advance: ms => { now += ms; }, set: value => { turn = value; }, insert: value => { turn = value; mutated([{ addedNodes: [value.user] }]); }, mutate: records => mutated(records) };
}
const node = (text) => ({ text, isConnected: true });
module.exports = { setup, node };
