// desktop/src/renderer/proxy-sync-row.tsx
// 同步设置页里的「网络代理」行（spec §6.2）：跟随开关只走 polyask:proxy-follow（通用 preferences-follow 拒收 proxy 组），
// 当前值只显示模式名，不显示主机。阻断或本机存储损坏时，打开和关闭都会被主进程拒绝，这里先禁用并说明。
import { useState } from "react";
import type { DesktopCopy } from "../shared/copy";
import { describeProxyResult, proxyModeLabel } from "../shared/proxy-copy";
import { proxyErrorCode, proxyOutcome } from "./proxy-form";
import { shell } from "./shell-api";
import type { ProxyStateHandle } from "./use-proxy-state";

export function ProxySyncRow(props: {
  readonly copy: DesktopCopy;
  readonly proxy: ProxyStateHandle;
  readonly disabled: boolean;
}): React.JSX.Element {
  const { copy, proxy } = props;
  const state = proxy.state;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const broken = !!state && (state.blocked || state.stored === "invalid");
  const message = (code: string | null): string => code === "proxy_invalid" ? copy.proxySyncFixFirst : describeProxyResult(copy, code);
  const change = async (enabled: boolean): Promise<void> => {
    if (pending || !state || broken || state.following === enabled) return;
    setPending(true); setFailure("");
    let text = "";
    try {
      const outcome = proxyOutcome(await shell.followProxy(enabled));
      if (!outcome.ok) text = message(outcome.code);
    } catch (error) {
      text = message(proxyErrorCode(error));
    }
    await proxy.refresh();
    setPending(false); setFailure(text);
  };
  const loading = copy.preferenceSyncLoading;
  return <fieldset disabled={props.disabled || pending || !state || broken} data-preference-group="proxy"
    aria-describedby="settings-follow-proxy-facts settings-follow-proxy-hint settings-follow-hint">
    <legend>{copy.proxySyncTitle}</legend>
    <dl id="settings-follow-proxy-facts" className="settings-preference-facts">
      <div><dt>{copy.preferenceSyncSource}</dt><dd data-preference-source>{!state ? loading : state.following ? copy.preferenceSyncSourceShared : copy.preferenceSyncSourceLocal}</dd></div>
      <div><dt>{copy.preferenceSyncCurrent}</dt><dd data-preference-current>{!state ? loading : proxyModeLabel(copy, state.formValue.mode)}</dd></div>
      <div><dt>{copy.preferenceSyncScope}</dt><dd data-preference-scope>{!state ? loading : state.following ? copy.preferenceSyncScopeShared : copy.preferenceSyncScopeLocal}</dd></div>
    </dl>
    <p id="settings-follow-proxy-hint">{broken ? copy.proxySyncFixFirst : copy.proxySyncHint}</p>
    <div className="settings-display-options">{(["local", "shared"] as const).map(value => <label key={value}>
      <input type="radio" name="settings-follow-proxy" value={value} checked={(state?.following ?? false) === (value === "shared")}
        onChange={() => { void change(value === "shared"); }} />
      <span>{value === "shared" ? copy.preferenceSyncFollow : copy.preferenceSyncLocal}</span>
    </label>)}</div>
    {failure ? <p className="settings-control-hint" role="alert">{failure}</p> : null}
  </fieldset>;
}
