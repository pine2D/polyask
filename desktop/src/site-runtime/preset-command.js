// 选项发现/验证是交互命令，与群发共用串行队列；普通 state/selection 仍完全只读。
(function () {
  'use strict';
  const S = window.__AMS;
  if (!S) return;
  S.withPresetRestored = async function (adapter, deadline, action) {
    S.checkDeadline(deadline);
    const original = adapter.currentPreset();
    if (!S.presetValid?.(original)) throw new Error('preset_unavailable');
    const remaining = deadline - Date.now(), reserve = Math.min(4000, Math.ceil(remaining / 2));
    const workDeadline = deadline - reserve;
    if (workDeadline <= Date.now()) throw new Error('timeout');
    try { return await action(original, workDeadline); }
    finally {
      S.escMenus();
      if (!S.presetSame(adapter.currentPreset(), original)) {
        try {
          S.checkDeadline(deadline);
          await adapter.applyPreset(original, deadline);
          if (!S.presetSame(adapter.currentPreset(), original)) throw new Error('preset_restore_failed');
        } catch (_) { throw new Error('preset_restore_failed'); }
      }
      S.escMenus();
    }
  };
  S.presetCommand = function (msg, respond, serialize) {
    if (msg.cmd !== 'tierPreset') return false;
    serialize(async () => {
      const deadline = Number(msg.deadline) || 0, a = S.pickAdapter(), action = msg.action;
      if (Date.now() >= deadline) return { ok: false, code: 'timeout' };
      if (!a?.currentPreset || !a.applyPreset || !a.presetOptions) return { ok: false, code: 'preset_unavailable' };
      if (!action || !['current', 'options', 'verify'].includes(action.kind)) return { ok: false, code: 'invalid_response' };
      if (S.generationProbe?.() === 'generating') return { ok: false, code: "preset_busy" };
      if (!S.findComposer()) return { ok: false, code: 'not_ready' };
      const current = a.currentPreset();
      if (!S.presetValid(current)) return { ok: false, code: 'preset_unavailable' };
      if (action.kind === 'current') return { ok: true, current };
      if (action.kind === 'options') return { ok: true, current, catalog: await a.presetOptions(action.model, deadline) };
      if (!S.presetValid(action.preset)) return { ok: false, code: 'invalid_response' };
      const verified = await S.withPresetRestored(a, deadline, (_original, workDeadline) => a.applyPreset(action.preset, workDeadline));
      return { ok: true, current, verified };
    }).then(respond, error => respond({ ok: false, code: ['preset_unavailable', 'preset_restore_failed', 'timeout'].includes(error?.message)
      ? error.message : 'preset_unavailable' }));
    return true;
  };
})();
