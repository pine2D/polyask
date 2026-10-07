import type { SiteDefinition, SiteKey } from '../shared/contracts';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { FolderModal } from './folder-modal';

export function BroadcastRetryReview(props: {
  copy: DesktopCopy; sites: readonly SiteDefinition[]; selected: readonly SiteKey[]; busy: boolean; inspecting?: boolean;
  onToggle: (site: SiteKey) => void; onInspect: (site: SiteKey) => void;
  onConfirm: () => void; onCancel: () => void;
}): React.JSX.Element {
  return <FolderModal copy={props.copy} title={props.copy.retryReviewTitle} busy={props.busy} onCancel={props.onCancel}>
    <div className="broadcast-retry-review">
      <p>{props.copy.retryReviewDescription}</p>
      {props.inspecting && <p role="status">{props.copy.retryInspectionPending}</p>}
      {!props.sites.length ? <p role="status">{props.copy.retryReviewResolved}</p> :
        <ul>{props.sites.map(site => <li key={site.key}>
          <label><input type="checkbox" name="retry-site" value={site.key} checked={props.selected.includes(site.key)}
            disabled={props.busy} onChange={() => props.onToggle(site.key)} />
            {formatCopy(props.copy.retryReviewChoice, {site: site.label})}</label>
          <button type="button" data-inspect-site={site.key} disabled={props.busy} onClick={() => props.onInspect(site.key)}>
            {formatCopy(props.copy.retryInspectSite, {site: site.label})}</button>
        </li>)}</ul>}
      <footer><button type="button" className="retry-review-confirm" disabled={props.busy || !props.selected.length}
        onClick={props.onConfirm}>{formatCopy(props.copy.retryReviewConfirm, {count: props.selected.length})}</button></footer>
    </div>
  </FolderModal>;
}
