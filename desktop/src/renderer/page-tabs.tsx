import { useRef } from "react";

import type { SiteDefinition, SiteKey } from "../shared/contracts";
import { formatCopy, type DesktopCopy } from "../shared/copy";
import type { SiteStatus } from "../shared/protocol";
import { paginateSiteKeys } from "../shared/site-pages";
import { pageTabKeyAction } from "./keyboard";
import { pageSubmissionSummary, pageSiteDetail } from "./page-submission";
import { commandHint } from "./command-hint";

interface PageTabsProps {
  readonly copy: DesktopCopy;
  readonly isMac?: boolean;
  readonly sites?: readonly SiteDefinition[];
  readonly selectedSites: readonly SiteKey[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly page: number;
  readonly inputMethod: "keyboard" | "pointer";
  readonly onPageChange: (page: number, inputMethod: "keyboard" | "pointer") => void;
}

export function PageTabs(props: PageTabsProps): React.JSX.Element | null {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const pages = paginateSiteKeys(props.selectedSites);
  if (pages.length <= 1) return null;
  let nextStart = 1;

  return (
    <div className="page-tabs" role="tablist" aria-label={props.copy.sitePages} data-input-method={props.inputMethod}>
      <span
        className="page-tab-indicator"
        aria-hidden="true"
        style={{ width: `${100 / pages.length}%`, transform: `translateX(${props.page * 100}%)` }}
      />
      {pages.map((sites, index) => {
        const start = nextStart;
        nextStart += sites.length;
        const range = `${start}–${start + sites.length - 1}`;
        const badges = pageSubmissionSummary(sites, props.statuses, props.copy);
        const label = [formatCopy(props.copy.sitePageLabel, { page: index + 1, range }), ...badges.map(b => b.label)].join(", ");
        const details = sites.map(key => pageSiteDetail(
          props.sites?.find(site => site.key === key)?.label ?? key, props.statuses[key], props.copy
        )).join("; ");
        const selected = index === props.page;
        return (
          <button
            type="button"
            id={`site-page-tab-${index}`}
            role="tab"
            data-hint={commandHint(`${label}. ${details}`, index === 0 ? "show-page-1" : index === 1 ? "show-page-2" : "show-page-3", props.isMac)}
            aria-label={`${label}. ${details}`}
            aria-selected={selected}
            aria-controls={`site-page-panel-${index}`}
            tabIndex={selected ? 0 : -1}
            data-page={index}
            key={index}
            ref={(element) => { buttons.current[index] = element; }}
            onClick={() => props.onPageChange(index, "pointer")}
            onKeyDown={(event) => {
              const action = pageTabKeyAction(event.key, index, pages.length);
              if (!action) return;
              event.preventDefault();
              buttons.current[action.focus]?.focus();
              if (action.activate) props.onPageChange(action.focus, "keyboard");
            }}
          >
            <span>{range}</span>
            {badges.map(badge => <i key={badge.state} className={`page-tab-badge ${badge.state}`} aria-hidden="true">
              <span>{badge.symbol}</span>{badge.count}
            </i>)}
          </button>
        );
      })}
    </div>
  );
}
