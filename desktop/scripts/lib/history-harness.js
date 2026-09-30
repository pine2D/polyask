const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup(host = "example.test") {
  let turn = null, mutated = () => {}, now = 1000;
  const listeners = new Map();
  const events = { addEventListener: (name, f) => listeners.set(name, f), removeEventListener: name => listeners.delete(name) };
  const adapter = { historyTurn: () => turn, generation: () => "generating" };
  const S = { adapters: { [host]: adapter }, toMarkdown: node => node.text };
  const context = { URL, getComputedStyle: node => ({ cursor: node.cursor || "auto" }), Date: { now: () => now }, setTimeout: () => 1, clearTimeout: () => {}, document: { ...events, documentElement: {} }, MutationObserver: class { constructor(callback) { mutated = callback; } observe() {} disconnect() {} }, window: { ...events, __AMS: S }, location: { hostname: host, href: `https://${host}/chat/one` } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../src/site-runtime/history.js"), "utf8"), context);
  return { S, customActivate: cursor => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ nodeType: 1, cursor, matches: () => false }] }), activate: () => listeners.get('pointerdown')?.({ isTrusted: true, composedPath: () => [{ matches: () => true }] }),
    input: () => listeners.get('beforeinput')?.({type:'beforeinput',isTrusted:true}), navigate: href => { context.location.href = href; }, popstate: () => listeners.get('popstate')?.({}), advance: ms => { now += ms; }, set: value => { turn = value; }, insert: value => { turn = value; mutated([{ addedNodes: [value.user] }]); } };
}
const node = (text) => ({ text, isConnected: true });
module.exports = { setup, node };
