// desktop/src/renderer/settings-proxy.tsx
// 「网络代理」设置卡（spec §6.2）。只读 proxy-state；写操作全部经主进程 proxy-* 通道，回包只带码，文案在这里翻译。
import { useEffect, useRef, useState } from "react";
import type { DesktopCopy } from "../shared/copy";
import { formatCopy } from "../shared/copy";
import { describeProxyField, describeProxyResult, PROXY_SCHEME_LABELS, proxyModeLabel } from "../shared/proxy-copy";
import { PROXY_MODES, PROXY_SCHEMES, type ProxyField, type ProxyPreference, type ProxyScheme } from "../shared/proxy-preference";
import { formatBackupValue } from "./backup-data";
import {
  checkProxyForm, formFromPreference, hostLooksCombined, isSocks, passwordProblem, pendingKey, proxyEndpoint, proxyErrorCode,
  proxyFormHints, proxyOutcome, proxyReloadOutcome, proxyRequest, proxyStateEndpoint, proxyTestOutcome, sameProxyForm,
  type ProxyForm, type ProxyStateView
} from "./proxy-form";
import { shell } from "./shell-api";
import type { ProxyStateHandle } from "./use-proxy-state";

type ProxyAction = "save" | "test" | "clear" | "accept" | "keep" | "reload";
type FieldError = ProxyField | "password";

const FIELD_IDS: Readonly<Record<FieldError, string>> = {
  host: "settings-proxy-host", port: "settings-proxy-port", bypass: "settings-proxy-bypass",
  username: "settings-proxy-username", password: "settings-proxy-password", shape: "settings-proxy-mode-custom"
};

export function SettingsProxy(props: {
  readonly copy: DesktopCopy;
  readonly proxy: ProxyStateHandle;
  /**
   * 设置页自身的忙碌（同步动作等）与外壳的 operationBusy（群发、综合、新会话、站点参与切换）合并后的值。
   * 为真时禁用经 OperationGate 的写操作（保存、清除密码、应用/保留、重新加载全部站点）；主进程的 proxy_busy 仍兜底。
   */
  readonly busy: boolean;
  /** 设置页底栏 + 外壳 sr-only live 区的统一播报口；本卡不另建 live 区。 */
  readonly onFeedback: (message: string) => void;
  readonly onOpenSync?: () => void;
}): React.JSX.Element {
  const { copy, proxy } = props;
  const state = proxy.state;
  const [draft, setDraft] = useState<ProxyForm | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<FieldError | null>(null);
  const [action, setAction] = useState<ProxyAction | null>(null);
  const [saved, setSaved] = useState(false);
  // 编辑起点：开始编辑（改任一字段或输入密码）时的已存值。推送改了已存值也不覆盖草稿（Review Focus 2），
  // base 只用来判断「是否有未保存修改」与「编辑期间是否被别处改动」。
  const [base, setBase] = useState<ProxyPreference | null>(null);
  const inFlight = useRef(false), previous = useRef<ProxyStateView | null>(null), feedback = useRef(props.onFeedback);
  const editingNow = useRef(false), focusAfter = useRef<Element | "title" | null>(null);
  feedback.current = props.onFeedback;
  // 草稿回到编辑起点（改了又改回）不算未保存修改；密码框有内容算。
  const editing = (draft !== null && base !== null && !sameProxyForm(draft, formFromPreference(base))) || !!password;
  editingNow.current = editing;
  useEffect(() => {
    // 不是本卡操作引起的变化（冲刷挂起、出现新的待确认项）由推送驱动播报；本卡操作由 run() 播报。
    const before = previous.current;
    previous.current = state;
    if (!before || !state || inFlight.current) return;
    const pending = state.pendingConfirm;
    const messages: string[] = [];
    if (pending && pendingKey(state) !== pendingKey(before)) {
      messages.push(formatCopy(copy.proxyPendingBanner, { endpoint: proxyEndpoint(pending), scheme: PROXY_SCHEME_LABELS[pending.scheme] }));
    } else if (state.authFailed && !before.authFailed) {
      // spec §3.6 熔断：由推送置位，播报一次；常驻提示见下方 notice。
      messages.push(formatCopy(copy.proxyAuthRejected, { endpoint: proxyStateEndpoint(state) }));
    } else if (before.pending && !state.pending) {
      messages.push(state.appliedResult === "ok" ? copy.proxyQueueFlushed : copy.proxyResultApplyFailed);
    }
    // 有未保存修改时推送改了已存值：表单保持用户输入，只更新状态区与横幅，这里提示一次（Review Focus 2）。
    if (editingNow.current && !sameProxyForm(formFromPreference(before.formValue), formFromPreference(state.formValue))) messages.push(copy.proxyEditsKept);
    if (messages.length) feedback.current(messages.join(" "));
  }, [copy, state]);
  useEffect(() => {
    // 操作结束、控件解除禁用后再还焦点：原控件仍在且可用就回到它，否则交给卡片标题，绝不落到 body。
    const target = focusAfter.current;
    if (action !== null || target === null) return;
    focusAfter.current = null;
    const usable = target !== "title" && target.isConnected && target !== document.body && !target.matches(":disabled");
    ((usable ? target : document.getElementById("settings-proxy-title")) as HTMLElement | null)?.focus();
  }, [action]);
  if (!state) return <section className="settings-card settings-proxy" aria-labelledby="settings-proxy-title" aria-busy={!proxy.failed}>
    <h2 id="settings-proxy-title" tabIndex={-1}>{copy.proxyTitle}</h2>
    <p>{copy.proxyDescription}</p>
    <p className="settings-control-hint">{proxy.failed ? copy.proxyUnavailable : copy.proxyLoading}</p>
  </section>;

  const form = editing ? draft ?? formFromPreference(base ?? state.formValue) : formFromPreference(state.formValue);
  const stale = editing && base !== null && !sameProxyForm(formFromPreference(base), formFromPreference(state.formValue));
  const hints = proxyFormHints(form, state.linuxDesktopProxy);
  const pending = state.pendingConfirm;
  const working = action !== null;
  const custom = form.mode === "custom";
  // 清除密码会重存 formValue：只在已生效的是可用的自定义代理时提供。存储损坏/阻断时 formValue 是默认值，
  // 重存会把 fail-closed 阻断换成跟随系统；system/direct 时重存也毫无意义（I1）。
  const clearable = state.applied?.mode === "custom" && !state.blocked && state.stored === "ok";
  const edit = (patch: Partial<ProxyForm>): void => {
    const next = { ...form, ...patch };
    if (!editing) setBase(state.formValue);
    setDraft(isSocks(next.scheme) ? { ...next, username: "" } : next);
    setError(null);
  };
  const reset = (): void => { setDraft(null); setPassword(null); setBase(null); setError(null); };
  const editPassword = (value: string): void => {
    // 只改密码也算开始编辑：表单钉在当前已存值上，丢掉之前改回原样的旧草稿。
    if (!editing) { setBase(state.formValue); setDraft(null); }
    setPassword(value); setError(null);
  };
  const discard = (): void => {
    reset();
    // 按钮随提示一起消失，焦点交给卡片标题，避免落到 body。
    queueMicrotask(() => document.getElementById("settings-proxy-title")?.focus());
  };
  // 主机栏粘贴了 URL / host:port / user@host：同样是 host 字段错误、输入原样保留，只换更具体的提示（Review Focus 3）。
  const fieldMessage = (field: FieldError): string =>
    field === "host" && hostLooksCombined(form.host) ? copy.proxyErrorHostCombined : describeProxyField(copy, field);
  const run = async (kind: ProxyAction, task: () => Promise<string>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    focusAfter.current = document.activeElement;
    setAction(kind);
    let text: string;
    try { text = await task(); } catch (failure) { text = describeProxyResult(copy, proxyErrorCode(failure)); }
    await proxy.refresh();
    inFlight.current = false;
    setAction(null);
    props.onFeedback(text);
  };
  const checked = (): ProxyPreference | null => {
    const check = checkProxyForm(form, state.formValue);
    const field: FieldError | null = !check.ok ? check.field
      : custom && !hints.socks && passwordProblem(password) ? "password" : null;
    if (check.ok && field === null) { setError(null); return check.value; }
    const failed = field ?? "shape";
    setError(failed);
    props.onFeedback(fieldMessage(failed));
    queueMicrotask(() => document.getElementById(FIELD_IDS[failed])?.focus());
    return null;
  };
  const save = (): void => {
    if (inFlight.current || props.busy || pending) return;
    const value = checked();
    if (value) void run("save", async () => {
      const outcome = proxyOutcome(await shell.saveProxy(proxyRequest(value, password)));
      if (!outcome.ok) return describeProxyResult(copy, outcome.code);
      reset(); setSaved(true);
      return outcome.secretFailed ? copy.proxySavedSecretFailed : copy.proxySaved;
    });
  };
  const testConnection = (): void => {
    if (inFlight.current) return;
    const value = checked();
    if (value) void run("test", async () => {
      const outcome = proxyTestOutcome(await shell.testProxy(proxyRequest(value, password)));
      // 要求重新输入密码的提示必须带 host:port（spec §4.5）；这里的端点是本次被测的表单值。
      if (!outcome.ok && outcome.code === "proxy_auth_failed") return formatCopy(copy.proxyAuthRejected, { endpoint: proxyEndpoint(value) });
      if (!outcome.ok) return describeProxyResult(copy, outcome.code);
      // 只有自定义代理的直连才是绕过列表造成的；不使用代理、或系统没有代理时直连就是预期线路。
      const text = outcome.route === "proxy" ? copy.proxyTestOk : value.mode === "custom" ? copy.proxyTestDirect : copy.proxyTestConnected;
      return formatCopy(text, { ms: outcome.ms });
    });
  };
  const clearPassword = (): void => {
    if (inFlight.current || props.busy || pending || !clearable) return;
    void run("clear", async () => {
      const outcome = proxyOutcome(await shell.saveProxy({ value: state.formValue, password: null }));
      if (!outcome.ok) return describeProxyResult(copy, outcome.code);
      setPassword(null);
      return outcome.secretFailed ? copy.proxyPasswordClearIncomplete : copy.proxyPasswordCleared;
    });
  };
  const decide = (kind: "accept" | "keep"): void => {
    if (!pending || props.busy) return;
    void run(kind, async () => {
      const outcome = proxyOutcome(kind === "accept" ? await shell.acceptProxy(pending) : await shell.followProxy(false));
      if (!outcome.ok) return describeProxyResult(copy, outcome.code);
      reset();
      focusAfter.current = "title"; // 横幅连同按钮一起消失，焦点交给卡片标题（同 discard）
      return kind === "accept" ? copy.proxyAccepted : copy.proxyKeptLocal;
    });
  };
  const reload = (): void => {
    if (props.busy) return;
    void run("reload", async () => {
      // 先识别 {ok:false, result}：proxy_busy 要说明原因（spec §3.4 / §6.2），不能落成通用失败。
      const outcome = proxyReloadOutcome(await shell.reloadProxySites());
      if (!outcome.ok) return describeProxyResult(copy, outcome.code);
      return outcome.skipped.length ? formatCopy(copy.proxyReloadSkipped, {
        sites: outcome.skipped.map(site => formatBackupValue(site, "site", copy, "")).join(", ")
      }) : copy.proxyReloaded;
    });
  };
  const submitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    // IME 组字中的 Enter 是选词，不是提交。
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    save();
  };
  const describedBy = (field: FieldError, ...extra: string[]): string | undefined =>
    [error === field ? "settings-proxy-error" : "", ...extra].filter(Boolean).join(" ") || undefined;
  const invalid = (field: FieldError): true | undefined => error === field ? true : undefined;
  const endpoint = proxyStateEndpoint(state);
  const secret = state.secret;
  // 已生效的不是自定义代理时，已存密码报 mismatch（身份为空）或 unreadable 都与当前连接无关，端点也只会是 ":0"；不提示重新输入（C5、Minor 1）。
  const quietSecret = (secret === "mismatch" || secret === "unreadable") && state.applied?.mode !== "custom";
  const secretText = quietSecret ? "" : secret === "mismatch" || secret === "unreadable" ? formatCopy(copy.proxySecretReenter, { endpoint })
    : { unknown: copy.proxySecretUnknown, saved: copy.proxySecretSaved, memory: copy.proxySecretMemory, none: copy.proxySecretNone }[secret];
  const secretLine = [secretText, state.encryption ? "" : copy.proxyNoSecureStorage].filter(Boolean).join(" ");
  const credentials = custom && !hints.socks;
  const notice = state.stored === "invalid" ? ["danger", copy.proxyStoredInvalid] : state.blocked ? ["danger", copy.proxyBlocked]
    : state.authFailed ? ["danger", formatCopy(copy.proxyAuthRejected, { endpoint })]
    : state.appliedResult === "proxy_apply_failed" ? ["warning", copy.proxyKeptPrevious] : null;
  const busyHint = props.busy ? "settings-proxy-busy" : "";
  const saveDescribedBy = [pending ? "settings-proxy-save-blocked" : "", stale ? "settings-proxy-stale" : "", busyHint].filter(Boolean).join(" ") || undefined;

  return <section className="settings-card settings-proxy" aria-labelledby="settings-proxy-title" aria-busy={working}>
    <h2 id="settings-proxy-title" tabIndex={-1}>{copy.proxyTitle}</h2>
    <p>{copy.proxyDescription}</p>
    {notice ? <p className={`settings-notice ${notice[0]}`} data-proxy-notice={notice[0]}>{notice[1]}</p> : null}
    {state.pending ? <p className="settings-control-hint" data-proxy-queued>{copy.proxyQueued}</p> : null}
    {state.following ? <p className="settings-control-hint" data-proxy-source="sync">{copy.proxyFromSync}</p> : null}
    {state.following && props.onOpenSync ? <div className="settings-actions">
      <button type="button" className="settings-control" onClick={props.onOpenSync}>{copy.proxyOpenSync}</button>
    </div> : null}
    {pending ? <div className="settings-notice warning settings-proxy-banner" role="group" aria-labelledby="settings-proxy-pending">
      <p id="settings-proxy-pending">{formatCopy(copy.proxyPendingBanner, { endpoint: proxyEndpoint(pending), scheme: PROXY_SCHEME_LABELS[pending.scheme] })}</p>
      <div className="settings-actions">
        <button type="button" className="settings-control primary" disabled={working || props.busy} onClick={() => decide("accept")}>{copy.proxyPendingApply}</button>
        <button type="button" className="settings-control" disabled={working || props.busy} onClick={() => decide("keep")}>{copy.proxyPendingKeep}</button>
      </div>
    </div> : null}
    <p id="settings-proxy-mode-label" className="preference-title">{copy.proxyModeLabel}</p>
    <div className="settings-display-options" role="radiogroup" aria-labelledby="settings-proxy-mode-label" aria-describedby={describedBy("shape")}>
      {PROXY_MODES.map(mode => <label key={mode}>
        <input type="radio" id={`settings-proxy-mode-${mode}`} name="settings-proxy-mode" value={mode} checked={form.mode === mode}
          disabled={working} onChange={() => edit({ mode })} />
        <span>{proxyModeLabel(copy, mode)}</span>
      </label>)}
    </div>
    {hints.linuxEnv ? <p className="settings-control-hint" data-proxy-hint="linux-env">{copy.proxyLinuxEnvHint}</p> : null}
    {custom ? <div className="settings-proxy-fields">
      <label><span>{copy.proxyScheme}</span>
        <select id="settings-proxy-scheme" name="settings-proxy-scheme" value={form.scheme} disabled={working}
          aria-describedby={hints.socks ? "settings-proxy-socks-hint" : undefined}
          onChange={event => edit({ scheme: event.target.value as ProxyScheme })}>
          {PROXY_SCHEMES.map(scheme => <option key={scheme} value={scheme}>{PROXY_SCHEME_LABELS[scheme]}</option>)}
        </select></label>
      <label><span>{copy.proxyHost}</span>
        <input id="settings-proxy-host" name="settings-proxy-host" value={form.host} autoComplete="off" spellCheck={false} disabled={working}
          aria-invalid={invalid("host")} aria-describedby={describedBy("host")} onKeyDown={submitOnEnter} onChange={event => edit({ host: event.target.value })} /></label>
      <label><span>{copy.proxyPort}</span>
        <input id="settings-proxy-port" name="settings-proxy-port" value={form.port} inputMode="numeric" autoComplete="off" disabled={working}
          aria-invalid={invalid("port")} aria-describedby={describedBy("port")} onKeyDown={submitOnEnter} onChange={event => edit({ port: event.target.value })} /></label>
      <label><span>{copy.proxyUsername}</span>
        <input id="settings-proxy-username" name="settings-proxy-username" value={form.username} autoComplete="off" spellCheck={false} disabled={working || hints.socks}
          aria-invalid={invalid("username")} aria-describedby={describedBy("username", hints.socks ? "settings-proxy-socks-hint" : "", hints.plaintext ? "settings-proxy-plaintext-hint" : "")}
          onKeyDown={submitOnEnter} onChange={event => edit({ username: event.target.value })} /></label>
      <label><span>{copy.proxyPassword}</span>
        <input id="settings-proxy-password" name="settings-proxy-password" type="password" value={password ?? ""} autoComplete="off" disabled={working || hints.socks}
          aria-invalid={invalid("password")} aria-describedby={describedBy("password", credentials ? secretLine ? "settings-proxy-secret" : "" : "settings-proxy-socks-hint")}
          onKeyDown={submitOnEnter} onChange={event => editPassword(event.target.value)} /></label>
      <label className="settings-proxy-wide"><span>{copy.proxyBypass}</span>
        <textarea id="settings-proxy-bypass" name="settings-proxy-bypass" rows={3} value={form.bypass} spellCheck={false} disabled={working}
          aria-invalid={invalid("bypass")} aria-describedby={describedBy("bypass", "settings-proxy-bypass-hint")} onChange={event => edit({ bypass: event.target.value })} /></label>
      <p id="settings-proxy-bypass-hint" className="settings-control-hint settings-proxy-wide">{copy.proxyBypassHint}</p>
    </div> : null}
    {hints.socks ? <p id="settings-proxy-socks-hint" className="settings-control-hint" data-proxy-hint="socks">{copy.proxySocksHint}</p> : null}
    {hints.socks4Dns ? <p className="settings-control-hint" data-proxy-hint="socks4">{copy.proxySocks4Hint}</p> : null}
    {hints.plaintext ? <p id="settings-proxy-plaintext-hint" className="settings-control-hint" data-proxy-hint="plaintext">{copy.proxyPlaintextHint}</p> : null}
    {credentials && secretLine ? <p id="settings-proxy-secret" className="settings-control-hint" data-proxy-secret={secret}>{secretLine}</p> : null}
    {credentials && clearable && secret !== "none" ? <div className="settings-actions">
      <button type="button" className="settings-control" disabled={working || props.busy || !!pending} onClick={clearPassword}>{copy.proxyClearPassword}</button>
    </div> : null}
    {error ? <p id="settings-proxy-error" className="settings-control-hint" data-proxy-error={error}>{fieldMessage(error)}</p> : null}
    {stale ? <div className="settings-notice warning settings-proxy-banner" data-proxy-stale>
      <p id="settings-proxy-stale">{copy.proxyEditsKept}</p>
      <div className="settings-actions">
        <button type="button" className="settings-control" disabled={working} onClick={discard}>{copy.proxyDiscardEdits}</button>
      </div>
    </div> : null}
    <div className="settings-actions">
      <button type="button" className="settings-control" disabled={working} onClick={testConnection}>{action === "test" ? copy.proxyTesting : copy.proxyTest}</button>
      <button type="button" className="settings-control primary" disabled={working || props.busy || !!pending}
        aria-describedby={saveDescribedBy} onClick={save}>{action === "save" ? copy.proxySaving : copy.proxySave}</button>
    </div>
    {pending ? <p id="settings-proxy-save-blocked" className="settings-control-hint">{copy.proxySaveBlockedPending}</p> : null}
    {props.busy ? <p id="settings-proxy-busy" className="settings-control-hint">{copy.proxyResultBusy}</p> : null}
    {saved ? <div className="settings-actions settings-proxy-reload">
      <button type="button" className="settings-control" disabled={working || props.busy}
        aria-describedby={["settings-proxy-reload-hint", busyHint].filter(Boolean).join(" ")} onClick={reload}>{copy.proxyReload}</button>
    </div> : null}
    {saved ? <p id="settings-proxy-reload-hint" className="settings-control-hint">{copy.proxyReloadHint}</p> : null}
  </section>;
}
