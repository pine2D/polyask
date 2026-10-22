// desktop/src/site-runtime/upload.js — 图片载荷校验、File 重建、文件输入/拖放与附件就绪确认。
(function () {
  "use strict";
  const S = window.__AMS;
  if (!S) return;

  const MAX_COUNT = 4;
  const MAX_BYTES = 10 * 1024 * 1024;
  const TYPES = new Set(["image/png", "image/jpeg"]);
  const CANDIDATES = 'img,canvas,[class*="attach"],[class*="upload"],[class*="preview"]';
  const FAILED_PREVIEW = '[data-testid="input-attachment-list"] .image-thumbnail.error';

  async function decodeImage(payload) {
    if (!payload || !TYPES.has(payload.type) || !Number.isInteger(payload.size) ||
        payload.size < 1 || payload.size > MAX_BYTES ||
        typeof payload.dataUrl !== "string" || payload.dataUrl.length > Math.ceil(MAX_BYTES * 4 / 3) + 64) return null;
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.dataUrl);
    if (!match || match[1] !== payload.type) return null;
    try {
      const raw = atob(match[2]);
      if (raw.length !== payload.size) return null;
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
      const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (payload.type === "image/png" ? !png : !jpeg) return null;
      const fallback = payload.type === "image/png" ? "image.png" : "image.jpg";
      const name = String(payload.name || fallback).split(/[\\/]/).pop().slice(0, 128) || fallback;
      const file = new File([bytes], name, { type: payload.type, lastModified: Date.now() });
      const bitmap = await createImageBitmap(file);
      if (bitmap && typeof bitmap.close === "function") bitmap.close();
      return file;
    } catch (e) { return null; }
  }

  function anchorRect(composer) {
    try {
      const r = composer.getBoundingClientRect();
      return { left: r.left - 80, right: r.right + 80, top: r.top - 420, bottom: r.bottom + 120 };
    } catch (e) { return null; }
  }
  function visibleNear(el, anchor) {
    if (!anchor || !el || typeof el.getBoundingClientRect !== "function") return false;
    try {
      const r = el.getBoundingClientRect();
      for (let node = el; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      }
      // 横向滚动附件条中的图片仍是附件；锚定附件条，不能只数屏幕里露出的缩略图。
      const strip = el.closest && el.closest('[data-chat-input-top-content], [data-testid="input-attachment-list"]');
      const box = strip ? strip.getBoundingClientRect() : r;
      return r.width > 0 && r.height > 0 && box.right >= anchor.left && box.left <= anchor.right &&
        box.bottom >= anchor.top && box.top <= anchor.bottom;
    } catch (e) { return false; }
  }
  function attr(el, name) {
    try { return el.getAttribute(name) || ""; } catch (e) { return ""; }
  }
  // 独立于 token()：错误提示是普通 alert DIV，几乎从不命中 token() 的 visual/container 条件，
  // 会被塌缩成同一个 ""，导致不同文案的新错误也被判成"已见过"（真机误判来源：F083）。
  function errToken(el) {
    const cls = typeof el.className === "string" ? el.className : "";
    return [el.tagName || "", el.id || "", cls, (el.textContent || "").trim().slice(0, 120)].join("|");
  }
  function token(el) {
    let bg = "";
    try { bg = getComputedStyle(el).backgroundImage || ""; } catch (e) {}
    let child = false, r = { width: 0, height: 0 };
    try { child = !!(el.querySelector && el.querySelector("img,canvas")); r = el.getBoundingClientRect(); } catch (e) {}
    const cls = typeof el.className === "string" ? el.className : "";
    const label = [attr(el, "aria-label"), attr(el, "title"), attr(el, "alt"), (el.textContent || "").trim().slice(0, 120)].join("|");
    const visual = /^(IMG|CANVAS)$/.test(el.tagName || "") && r.width >= 40 && r.height >= 40;
    const container = /attach|upload|preview/i.test(cls) && (child || /\.(png|jpe?g)\b/i.test(label) || /^url\(/i.test(bg));
    if ((!visual && !container) || /^data:image\/svg/i.test(el.src || "")) return "";
    return [
      el.tagName || "", el.src || attr(el, "src"), attr(el, "aria-label"), attr(el, "title"), attr(el, "alt"),
      cls, (el.textContent || "").trim().slice(0, 120), bg,
    ].join("|");
  }
  function snapshot(anchor) {
    const candidates = [...document.querySelectorAll(CANDIDATES)]
      .filter((el) => visibleNear(el, anchor) && token(el));
    // 只计独立预览：父容器和子图片不能各算一张。同源图片保留重数，不能用 Set 去重。
    const nodes = candidates.filter(el => !candidates.some(other => other !== el && el.contains && el.contains(other)));
    const tokens = nodes.map(token);
    const busy = [...document.querySelectorAll('[role="progressbar"],[aria-busy="true"],[class*="loading"],[class*="spinner"]')]
      .some((el) => el !== document.body && el !== document.documentElement && visibleNear(el, anchor));
    const errors = new Set([...document.querySelectorAll(`[role="alert"],${FAILED_PREVIEW}`)].filter((el) => {
      if (!visibleNear(el, anchor)) return false;
      return el.matches?.(FAILED_PREVIEW) || /upload|image|file|图片|文件|格式|大小|失败/i.test(el.textContent || "");
    }).map(errToken));
    return { tokens, nodes, busy, errors };
  }
  function addedTokens(current, before) {
    const remaining = [...before.tokens];
    return current.tokens.filter(value => {
      const index = remaining.indexOf(value);
      if (index < 0) return true;
      remaining.splice(index, 1); return false;
    });
  }
  async function waitAttachments(anchor, before, deadline, fileNames) {
    let candidate = "", since = 0;
    while (Date.now() < deadline) {
      const current = snapshot(anchor);
      if ([...current.errors].some((value) => !before.errors.has(value))) return false;
      const added = addedTokens(current, before);
      if (added.length >= fileNames.length && !current.busy) {
        const signature = added.sort().join("\n");
        if (signature !== candidate) { candidate = signature; since = Date.now(); }
        else if (Date.now() - since >= 400) return true;
      } else { candidate = ""; since = 0; }
      await S.sleep(Math.min(120, Math.max(0, deadline - Date.now())));
    }
    return false;
  }

  async function setInputFiles(input, files, composer, deadline) {
    if (!input || !files || !files.length) return false;
    const anchor = anchorRect(composer), before = snapshot(anchor);
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      if (receipt) receipt.started = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return false; }
    return waitAttachments(anchor, before, Number(deadline) || Date.now() + 15000, files.map((file) => file.name));
  }
  async function dropFiles(target, files, composer, deadline) {
    if (!target || !files || !files.length) return false;
    const anchor = anchorRect(composer), before = snapshot(anchor);
    try {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      if (receipt) receipt.started = true;
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, dataTransfer: transfer,
        }));
      }
    } catch (e) { return false; }
    return waitAttachments(anchor, before, Number(deadline) || Date.now() + 15000, files.map((file) => file.name));
  }
  let receipt = null;
  const clearUploadReceipt = () => { receipt = null; };
  function nativeDraftAttachments(composer, current) {
    const draftRegions = '[data-chat-input-top-content], [data-testid="input-attachment-list"], .attachment-preview-wrapper';
    return current.nodes.some(node => node.closest?.(draftRegions) || node.closest?.('form')?.contains(composer)) ||
      document.querySelectorAll('[data-testid="input-attachment-list"] .image-thumbnail').length > 0;
  }
  function draftRegion(node, composer) {
    let root = node;
    while (root.parentElement && !root.parentElement.contains(composer)) root = root.parentElement;
    const parent = root.parentElement;
    return parent && !root.contains(composer) ? { root, parent, previous: root.previousElementSibling, next: root.nextElementSibling } : null;
  }
  function currentDraftRoot({ root, parent, previous, next }, composer) {
    if (root.parentElement === parent && parent.contains(composer)) return root;
    if (root.isConnected) return null; // 原分支已搬到历史，不能复用。
    if (parent.contains(composer) && (!previous || previous.parentElement === parent) && (!next || next.parentElement === parent)) {
      const replacement = previous ? previous.nextElementSibling : parent.firstElementChild;
      if (replacement === next) return null; // 原槽位已清空。
      if (replacement && replacement.nextElementSibling === next && !replacement.contains(composer)) return replacement;
    }
    // 整块重挂而槽位证据也消失：不能根据旧 token 消失推断附件已清空。
    receipt.uncertain = true;
    return null;
  }
  function receiptDraftNodes(composer, current) {
    if (!receipt || receipt.url !== location.href) return [];
    const roots = receipt.regions.map(region => currentDraftRoot(region, composer)).filter(Boolean);
    return current.nodes.filter(node => roots.some(root => root.contains(node)));
  }
  // 纯文字也要检查：上次上传后未提交的原生附件不能悄悄跟进下一条提问。
  function hasPendingAttachments(composer) {
    const current = snapshot(anchorRect(composer));
    // 认上传时的草稿分支：预览子节点可重绘，整个分支/图片搬到历史区后不再归属草稿。
    const pending = receiptDraftNodes(composer, current);
    return !!(receipt && receipt.url === location.href && receipt.uncertain) || pending.length > 0 ||
      nativeDraftAttachments(composer, current);
  }
  async function uploadImages(payloads, adapter, composer, deadline) {
    if (!Array.isArray(payloads) || !payloads.length || payloads.length > MAX_COUNT)
      return { ok: false, code: "image_invalid" };
    const files = await Promise.all(payloads.map(decodeImage));
    if (files.some((file) => !file) || files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES)
      return { ok: false, code: "image_invalid" };
    if (!adapter || typeof adapter.attach !== "function")
      return { ok: false, code: "attachment_unsupported" };
    const end = Number(deadline) || Date.now() + 15000;
    if (Date.now() >= end) return { ok: false, code: "attachment_timeout" };
    const anchor = anchorRect(composer), before = snapshot(anchor);
    if (receipt && receipt.url === location.href) {
      const pending = receiptDraftNodes(composer, before), remaining = pending.map(token);
      if (receipt.uncertain) return { ok: false, code: "attachment_conflict" };
      if (remaining.length) {
        const same = payloads.length === receipt.payloads.length && payloads.every((p, i) =>
          p.name === receipt.payloads[i].name && p.dataUrl === receipt.payloads[i].dataUrl);
        const unchanged = receipt.nodes.length === payloads.length && receipt.nodes.every(node => pending.includes(node));
        if (receipt.ok && same && unchanged && !before.busy && before.errors.size === 0 &&
            remaining.slice().sort().join("\n") === receipt.signature) return { ok: true };
        return { ok: false, code: "attachment_conflict" };
      }
    }
    // 部分站点把原生草稿留到刷新后；没有本次运行期凭据时，不能把旧附件混进新问题。
    // 入场动画可能让整个编辑器透明，但原生附件模型已存在；拦截不能依赖可见性。
    if (nativeDraftAttachments(composer, before)) return { ok: false, code: "attachment_conflict" };
    const attempt = receipt = { url: location.href, payloads: payloads.slice(), ok: false, started: false, uncertain: false, nodes: [], regions: [], signature: "" };
    try {
      const ok = await adapter.attach(files, composer, end);
      attempt.ok = ok === true;
      if (typeof ok === "string") return { ok: false, code: ok };
      if (ok) return { ok: true };
      return { ok: false, code: Date.now() >= end ? "attachment_timeout" : "attachment_failed" };
    } catch (e) { return { ok: false, code: "attachment_failed" }; }
    finally {
      // 抛错也可能已经上传；派发后缺少预览不能证明没有附件，迟到上传须由用户刷新站点解除。
      const after = snapshot(anchor);
      attempt.nodes = after.nodes.filter(node => !before.nodes.includes(node));
      const added = addedTokens(after, before);
      const currentComposer = S.findComposer?.() || composer;
      attempt.regions = attempt.nodes.filter(node => added.includes(token(node)))
        .map(node => draftRegion(node, currentComposer)).filter(Boolean);
      attempt.signature = added.sort().join("\n");
      attempt.uncertain = attempt.started && !attempt.ok && attempt.nodes.length < files.length;
    }
  }

  Object.assign(S, { uploadImages, setInputFiles, dropFiles, clearUploadReceipt, hasPendingAttachments });
})();
