import type { DraftCopy } from '../shared/draft-copy';
import type { DraftKind } from '../shared/drafts';
import { draftPreviewFields } from './draft-preview-model';

export function DraftPreview({ kind, content, copy }: { readonly kind: DraftKind; readonly content: unknown; readonly copy: DraftCopy }): React.JSX.Element {
  const fields = draftPreviewFields(kind, content, copy);
  if (!fields.length) return <p>{content === null ? copy.draftEmpty : copy.draftPreviewUnavailable}</p>;
  return <dl className="draft-preview-fields">{fields.map(field => <div key={field.key} data-draft-field={field.key}>
    <dt>{field.label}</dt><dd>{field.entries.map((entry, index) => <div className="draft-preview-value" key={index}>
      {entry.label ? <strong>{entry.label}</strong> : null}<p>{entry.text}</p>
    </div>)}</dd>
  </div>)}</dl>;
}

/** Positioned over the existing icon, so the toolbar trigger keeps its width. */
export function DraftCopyBadge({ count }: { readonly count: number }): React.JSX.Element | null {
  return count > 0 ? <span className="draft-copy-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span> : null;
}
