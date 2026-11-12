import type { HTMLAttributes, ReactNode } from "react";
import type { SiteKey } from "../shared/contracts";

export type PillTone = "neutral" | "accent" | "success" | "warning" | "danger";

export function SiteGlyph(props: {
  readonly site: SiteKey | string;
  readonly className?: string;
}): React.JSX.Element {
  const cls = props.className ? `site-glyph ${props.className}` : "site-glyph";
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cls}
      data-site-glyph={props.site}
    >
      {glyphPaths(props.site)}
    </svg>
  );
}

function glyphPaths(site: string): ReactNode {
  switch (site) {
    case "chatgpt":
      return (
        <>
          <polygon points="8,1.8 13.4,4.9 13.4,11.1 8,14.2 2.6,11.1 2.6,4.9" />
          <circle cx="8" cy="8" r="2.3" />
          <path d="M8 2v3.7M13.2 11 10 9.1M2.8 11 6 9.1" />
        </>
      );
    case "claude":
      return (
        <>
          <path d="M8 2.1v11.8M2.1 8h11.8M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </>
      );
    case "gemini":
      return <path d="M8 1.6C8.5 5.6 10.4 7.5 14.4 8 10.4 8.5 8.5 10.4 8 14.4 7.5 10.4 5.6 8.5 1.6 8 5.6 7.5 7.5 5.6 8 1.6Z" />;
    case "grok":
      return (
        <>
          <circle cx="8" cy="8" r="5.6" />
          <path d="M3.2 12.8 12.8 3.2" />
        </>
      );
    case "deepseek":
      return (
        <>
          <path d="M2.3 9.4c1.6-3.6 5.3-5.4 9.1-4.1 1.5.5 2.4 1.8 2.3 3.3-.2 2.9-3.1 4.9-6.6 4.7-2.2-.1-3.9-1.4-4.8-3.9Z" />
          <path d="M6.4 8.2c1.2-.8 2.8-.8 4 .1" />
        </>
      );
    case "kimi":
      return (
        <>
          <path d="M10.9 12.8A5.5 5.5 0 1 1 11.2 3a4.3 4.3 0 0 0-.3 9.8Z" />
          <circle cx="12.2" cy="5.2" r="1.2" fill="currentColor" stroke="none" />
        </>
      );
    case "doubao":
      return (
        <>
          <rect x="2.3" y="3.5" width="7.8" height="6.8" rx="3.4" />
          <path d="M6.8 12.5h4a2.9 2.9 0 0 0 2.9-2.9v-.8" />
          <circle cx="6.2" cy="6.9" r="1" fill="currentColor" stroke="none" />
        </>
      );
    case "yuanbao":
      return (
        <>
          <path d="M2.2 6.8h11.6l-1.9 5.3a2 2 0 0 1-1.9 1.3H6a2 2 0 0 1-1.9-1.3L2.2 6.8Z" />
          <path d="M5 6.8a3 3 0 0 1 6 0" />
        </>
      );
    case "qianwen":
      return (
        <>
          <polygon points="8,2 13.2,5 13.2,11 8,14 2.8,11 2.8,5" />
          <path d="M8 5.2 10.6 6.7v3L8 11.2 5.4 9.7v-3L8 5.2ZM10.4 10.4l2.8 2.8" />
        </>
      );
    case "chatglm":
      return (
        <>
          <polygon points="8,1.8 14.2,8 8,14.2 1.8,8" />
          <path d="M5.4 8h5.2M8 5.4v5.2" />
        </>
      );
    default:
      return <circle cx="8" cy="8" r="4.8" />;
  }
}

export function SurfaceCluster(props: HTMLAttributes<HTMLDivElement> & {
  readonly tone?: "muted" | "sunken" | "elevated";
}): React.JSX.Element {
  const { tone, className, ...rest } = props;
  return <div {...rest} data-tone={tone} className={className ? `ui-cluster ${className}` : "ui-cluster"} />;
}

export function StatusPill(props: HTMLAttributes<HTMLSpanElement> & {
  readonly tone?: PillTone;
}): React.JSX.Element {
  const { tone = "neutral", className, ...rest } = props;
  return <span {...rest} data-tone={tone} className={className ? `ui-pill ${className}` : "ui-pill"} />;
}

export function SegmentedGroup(props: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <div role="group" aria-label={props.label} className={props.className ? `ui-segmented ${props.className}` : "ui-segmented"}>
      {props.children}
    </div>
  );
}

export function siteKeyFromSource(hostOrKey: string, label = ""): string {
  const token = `${hostOrKey} ${label}`.toLowerCase();
  if (token.includes("claude")) return "claude";
  if (token.includes("chatgpt") || token.includes("openai")) return "chatgpt";
  if (token.includes("gemini")) return "gemini";
  if (token.includes("deepseek")) return "deepseek";
  if (token.includes("doubao") || token.includes("豆包")) return "doubao";
  if (token.includes("qianwen") || token.includes("qwen") || token.includes("tongyi") || token.includes("千问") || token.includes("千問")) return "qianwen";
  if (token.includes("kimi") || token.includes("moonshot")) return "kimi";
  if (token.includes("yuanbao") || token.includes("元宝") || token.includes("元寶")) return "yuanbao";
  if (token.includes("chatglm") || token.includes("zhipu") || token.includes("bigmodel") || token.includes("智谱") || token.includes("智譜")) return "chatglm";
  if (token.includes("grok")) return "grok";
  return hostOrKey;
}

export function compactCharCount(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const count = [...trimmed].length;
  if (count < 1000) return `${count}`;
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
}
