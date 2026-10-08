import { resolveLocale } from '../shared/locale';

const COPY = {
  en: {
    lang: 'en', service: 'Google Drive sync', received: 'Google Drive authorization received',
    verifying: 'PolyAsk is verifying the connection. Return to PolyAsk to see the result.',
    denied: 'Authorization not completed', retry: 'Return to PolyAsk and connect Google Drive again when you are ready.',
    next: 'Return to PolyAsk', close: 'You can close this page after returning to the app.'
  },
  zhCN: {
    lang: 'zh-CN', service: 'Google Drive 同步', received: '已收到 Google Drive 授权',
    verifying: 'PolyAsk 正在验证连接，请返回应用查看结果。',
    denied: '未完成授权', retry: '请返回 PolyAsk，需要同步时可重新连接 Google Drive。',
    next: '返回 PolyAsk 查看结果', close: '返回应用后，可以关闭此页面。'
  },
  zhTW: {
    lang: 'zh-TW', service: 'Google Drive 同步', received: '已收到 Google Drive 授權',
    verifying: 'PolyAsk 正在驗證連線，請返回應用程式查看結果。',
    denied: '尚未完成授權', retry: '請返回 PolyAsk，需要同步時可重新連接 Google Drive。',
    next: '返回 PolyAsk 查看結果', close: '返回應用程式後，即可關閉此頁面。'
  }
} as const;

/** 回调仅证明已收到授权响应，实际连接结果仍由应用验证；不接收或展示 OAuth 参数。 */
export function renderOAuthCallbackPage(locale = 'en', denied = false): string {
  const copy = COPY[resolveLocale(locale)];
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PolyAsk · ${copy.service}</title>
<style>
:root { color-scheme: light dark; --canvas: #f6f7fb; --panel: #fff; --text: #222333; --muted: #666b80; --border: #d6d9e6; --accent: #4f46e5; --soft: #eeedff; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--canvas); color: var(--text); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { width: min(100%, 480px); }
.brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; font-size: 20px; font-weight: 650; }
.brand-mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--accent); color: #fff; }
.card { padding: 32px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); box-shadow: 0 8px 32px #11182708; }
.service { color: var(--muted); margin: 0 0 16px; font-size: 13px; }
.symbol { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: var(--soft); color: var(--accent); }
svg { width: 26px; height: 26px; }
h1 { margin: 20px 0 12px; font-size: 24px; line-height: 1.4; letter-spacing: -.02em; }
.message { color: var(--muted); margin: 0; }
.next { margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--border); font-weight: 600; color: var(--accent); }
.footnote { margin: 16px 0 0; color: var(--muted); font-size: 13px; text-align: center; }
@media (prefers-color-scheme: dark) { :root { --canvas: #13141c; --panel: #1c1d29; --text: #e7e9f4; --muted: #b5bbd1; --border: #35384c; --accent: #a5a0ff; --soft: #2b2850; } .brand-mark { color: #17152d; } }
@media (max-width: 400px) { body { padding: 16px; } .card { padding: 24px; } h1 { font-size: 22px; } }
</style></head><body><main>
<div class="brand"><span class="brand-mark" aria-hidden="true">P</span>PolyAsk</div>
<section class="card" aria-labelledby="result-title"><p class="service">${copy.service}</p>
<div class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${denied ? '<path d="M6 6l12 12M18 6L6 18"/>' : '<path d="M9 4L4 9l5 5M4 9h9a7 7 0 0 1 7 7v4"/>'}</svg></div>
<h1 id="result-title">${denied ? copy.denied : copy.received}</h1>
<p class="message">${denied ? copy.retry : copy.verifying}</p>
<p class="next">${copy.next}</p></section><p class="footnote">${copy.close}</p>
</main></body></html>`;
}
