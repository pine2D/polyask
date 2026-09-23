"use strict";
// Reuse the production guards in DOM fixtures; deadline behavior itself uses a fake-clock core.
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const context = { window: {}, t: key => key, Date, setTimeout };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../src/site-runtime/core.js"), "utf8"), context);
const { checkDeadline, tierAction } = context.window.__AMS;
module.exports = { checkDeadline, tierAction };
