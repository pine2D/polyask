import type { LibraryCopy } from '../shared/library-scale-copy';
import { formatCopy } from '../shared/copy';
import type { BulkOutcome, BulkRequest } from './library-bulk-runner';

export function LibraryBulkActions({ labels, count, mixed, disabled, running, done, result, onFavorite, onAdd, onExport, onStop, onRetry }: {
  labels: LibraryCopy; count: number; mixed: boolean; disabled: boolean; running: boolean; done: number;
  result: { request: BulkRequest; outcome: BulkOutcome } | null;
  onFavorite: (value: boolean) => void; onAdd: () => void; onExport: () => void; onStop: () => void; onRetry: () => void;
}) {
  return <>
    {(count > 0 || running) && <div className="library-bulk-actions">
      <span>{formatCopy(labels.bulkScope, { count })}</span>
      <button type="button" data-action="library-bulk-add-folder" disabled={disabled} onClick={onAdd}>{labels.bulkAddFolder}</button>
      <button type="button" data-action="library-bulk-favorite" disabled={disabled || mixed} onClick={() => onFavorite(true)}>{labels.bulkFavorite}</button>
      <button type="button" data-action="library-bulk-unfavorite" disabled={disabled || mixed} onClick={() => onFavorite(false)}>{labels.bulkUnfavorite}</button>
      <button type="button" data-action="library-bulk-export" disabled={disabled} onClick={onExport}>{labels.bulkExport}</button>
      {mixed && <p>{labels.favoriteOnly}</p>}
      {running && <><span role="status">{formatCopy(labels.bulkRunning, { done, total: result?.request.targets.length ?? count })}</span>
        <button type="button" data-action="library-bulk-stop" onClick={onStop}>{labels.bulkStop}</button></>}
    </div>}
    {result && !running && <div className="library-bulk-result" role="status">
      {formatCopy(labels.bulkResult, { succeeded: result.outcome.succeeded.length, failed: result.outcome.failed.length, stopped: result.outcome.stopped.length })}
      {!!result.outcome.failed.length && <button type="button" data-action="library-bulk-retry-failed" disabled={disabled} onClick={onRetry}>{labels.bulkRetry}</button>}
      {result.request.action === 'export' && !!(result.outcome.failed.length || result.outcome.stopped.length) && <p>{labels.exportIncomplete}</p>}
    </div>}
  </>;
}
