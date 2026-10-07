import { useEffect, useRef, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';

export function SynthesisPayloadPreview(props: {
  readonly copy: DesktopCopy;
  readonly value: string;
  readonly codePointCount: number;
}): React.JSX.Element {
  const [message, setMessage] = useState('');
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setMessage(''); return () => { epoch.current++; }; }, [props.value]);
  const copy = async () => {
    const request = ++epoch.current;
    try {
      await navigator.clipboard.writeText(props.value);
      if (request === epoch.current) setMessage(props.copy.synthesisPayloadCopied);
    } catch {
      if (request === epoch.current) setMessage(props.copy.synthesisPayloadCopyFailed);
    }
  };
  return <details className="synthesis-preview">
    <summary>{props.copy.synthesisPreview}<small>{formatCopy(props.copy.synthesisPayloadCount, { count: props.codePointCount })}</small></summary>
    <textarea name="synthesis-preview" aria-label={props.copy.synthesisPreview} readOnly value={props.value} />
    <button type="button" onClick={() => { void copy(); }}>{props.copy.synthesisCopyPayload}</button>
    <p role="status" aria-live="polite">{message}</p>
  </details>;
}
