import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { Tier } from "../shared/protocol";
import { DeepThinkIcon, FastIcon, SiteSettingIcon } from "./icons";
import { commandHint } from "./command-hint";

export function TierControls({ copy, tier, isMac, onChange }: {
  readonly copy: DesktopCopy; readonly tier: Tier; readonly isMac: boolean;
  readonly onChange: (value: Tier) => void;
}): React.JSX.Element {
  const options = [
    { value: null, label: copy.followSite, icon: "site-setting", glyph: <SiteSettingIcon /> },
    { value: "fast", label: copy.fast, icon: "fast", glyph: <FastIcon /> },
    { value: "think", label: copy.think, icon: "think", glyph: <DeepThinkIcon /> }
  ] as const;
  const short = tier === "think" ? copy.composerModeThink : tier === "fast" ? copy.composerModeFast : copy.composerModeSite;
  const description = formatCopy(copy.composerNextMode, { mode: options.find(item => item.value === tier)!.label });
  return <div className="tier-switch priority-p0" aria-label={description}>
    <span data-current-tier data-hint={description}>{short}</span>
    {options.map(({ value, label, icon, glyph }) => <button type="button" key={icon}
      data-hint={value === null ? label : commandHint(label, value === "think" ? "set-think" : "set-fast", isMac)}
      aria-label={label} aria-pressed={tier === value} data-tier-icon={icon}
      className={tier === value ? "active" : ""} onClick={() => onChange(value)}>{glyph}</button>)}
    {/* 窄栏只显示这个下拉：原生弹出层盖得住站点视图，键盘方向键可直接换档。 */}
    <select className="tier-select" name="tier" aria-label={description} data-hint={description} value={tier ?? "site"}
      onChange={event => onChange(event.target.value === "site" ? null : event.target.value as Exclude<Tier, null>)}>
      {options.map(({ value, icon }) => <option key={icon} value={value ?? "site"}>
        {value === "think" ? copy.composerModeThink : value === "fast" ? copy.composerModeFast : copy.composerModeSite}
      </option>)}
    </select>
  </div>;
}
