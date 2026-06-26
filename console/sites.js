// console/sites.js — 站点清单与预设分组（console 与 compose 共享，classic 全局脚本）
const SITES = [
  { host: "claude.ai", label: "Claude", url: "https://claude.ai/new", on: true },
  { host: "chatgpt.com", label: "ChatGPT", url: "https://chatgpt.com/", on: true },
  { host: "gemini.google.com", label: "Gemini", url: "https://gemini.google.com/app", on: true },
  { host: "chat.deepseek.com", label: "DeepSeek", url: "https://chat.deepseek.com/", on: false },
  { host: "www.doubao.com", label: "豆包", url: "https://www.doubao.com/chat/", on: false },
  { host: "www.qianwen.com", label: "千问", url: "https://www.qianwen.com/", on: false },
  { host: "www.kimi.com", label: "Kimi", url: "https://www.kimi.com/", on: false },
  { host: "yuanbao.tencent.com", label: "元宝", url: "https://yuanbao.tencent.com/chat/", on: false },
  { host: "chatglm.cn", label: "智谱", url: "https://chatglm.cn/main/alltoolsdetail", on: false },
];
const PRESETS = {
  intl: ["claude.ai", "chatgpt.com", "gemini.google.com"],
  cn: ["chat.deepseek.com", "www.doubao.com", "www.qianwen.com", "www.kimi.com", "yuanbao.tencent.com", "chatglm.cn"],
};
