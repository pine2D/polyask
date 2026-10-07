import type { SiteDefinition, SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import type { SiteStatus } from '../shared/protocol';
import type { SiteHealth } from '../shared/site-health';
import type { WorkbenchGuideModel } from './workbench-guide-model';
import { siteRecoveryAdvice, SITE_RECOVERY_COPY } from './site-health-recovery';

export interface WorkbenchGuideInviteProps {
  readonly copy: DesktopCopy; readonly model: WorkbenchGuideModel;
  readonly onOpen: () => void; readonly onDismiss: () => void;
}
export interface WorkbenchGuidePanelProps {
  readonly copy: DesktopCopy; readonly model: WorkbenchGuideModel;
  readonly sites: readonly SiteDefinition[];
  readonly statuses: Readonly<Record<string, SiteStatus>>;
  readonly health: Readonly<Partial<Record<SiteKey, SiteHealth>>>;
  readonly pending?: boolean;
  readonly onChooseSites: () => void;
  readonly onCheckSites: (sites: readonly SiteKey[]) => void;
  readonly onFocusSite: (site: SiteKey) => void;
  readonly onFocusPrompt: () => void;
  readonly onRead: () => void; readonly onCompare: () => void;
  readonly onDismiss: () => void;
}
export function WorkbenchGuideInvite(props: WorkbenchGuideInviteProps): React.JSX.Element | null {
  if (!['choose', 'ask'].includes(props.model.stage)) return null;
  return <div className="workbench-guide-invite" data-workbench-guide="invite">
    <button type="button" data-guide-action="open" aria-label={props.copy.guideInviteTitle} onClick={props.onOpen}>{props.copy.guideInviteShort}</button>
    <button type="button" data-guide-action="dismiss" aria-label={props.copy.guideInviteDismiss} onClick={props.onDismiss}>×</button>
  </div>;
}
export function WorkbenchGuidePanel(props: WorkbenchGuidePanelProps): React.JSX.Element | null {
  const { model, copy } = props;
  if (model.stage === 'hidden') return null;
  return <section className="workbench-guide-panel" data-workbench-guide="panel" aria-label={copy.guideInviteTitle}>
    <header><h2>{copy.guideInviteTitle}</h2><button type="button" aria-label={copy.guideInviteDismiss} onClick={props.onDismiss}>×</button></header>
    {model.stage === 'choose' && <><p>{formatCopy(copy.guideChoosePrompt, { count: model.participants.length })}</p>
      <button type="button" data-guide-action="choose" disabled={props.pending} onClick={props.onChooseSites}>{copy.guideChooseAction}</button></>}
    {model.stage === 'ask' && <><p>{copy.guideAskPrompt}</p><ul>
      {model.participants.map(key => {
        const site = props.sites.find(item => item.key === key);
        if (!site) return null;
        const health = props.health[key] ?? { site: key, state: 'unknown' as const, checks: [] };
        const advice = siteRecoveryAdvice(health, props.statuses[key] ?? { site: key, phase: 'ready' });
        return <li key={key} data-guide-site={key}><strong>{site.label}</strong><p>{copy[SITE_RECOVERY_COPY[advice.reason]]}</p>
          <button type="button" data-guide-focus-site={key} disabled={props.pending} onClick={() => props.onFocusSite(key)}>{formatCopy(copy.guideViewSite, { site: site.label })}</button></li>;
      })}
    </ul><button type="button" data-guide-action="check" disabled={props.pending} onClick={() => props.onCheckSites(model.participants)}>{copy.guideCheckTwo}</button>
      <button type="button" data-guide-action="prompt" disabled={props.pending} onClick={props.onFocusPrompt}>{copy.guideFocusPrompt}</button></>}
    {model.stage === 'waiting' && <p>{formatCopy(copy.guideWaitingCopies, { count: model.counts.submitted })}</p>}
    {['read', 'compare'].includes(model.stage) && <><p>{model.stage === 'compare' ? copy.guideCompleteCopies : copy.guideIncompleteCopies}</p>
      <button type="button" data-guide-action="read" disabled={props.pending} onClick={props.onRead}>{copy.guideReadCopies}</button>
      {model.stage === 'compare' && <button type="button" data-guide-action="compare" disabled={props.pending} onClick={props.onCompare}>{copy.guideCompareCopies}</button>}
    </>}
  </section>;
}
