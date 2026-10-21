import { useEffect, useState } from 'react';
import { formatCopy, type DesktopCopy } from '../shared/copy';
import { isStoredQuestionAttachmentManifest, type QuestionAttachmentsManifest } from '../shared/question-attachments';
import { validateImages, type DesktopImage } from '../shared/images';
import { QuestionImageDialog } from './question-image-dialog';
import { shell } from './shell-api';

type LoadedQuestionImage = { image: DesktopImage; onDecodeError: () => void };

export function QuestionAttachments({ questionId, inputImageCount, copy, imageSyncEnabled = false }: {
  questionId: string; inputImageCount: number; copy: DesktopCopy; imageSyncEnabled?: boolean;
}) {
  const [manifest, setManifest] = useState<QuestionAttachmentsManifest | null>(null);
  const [images, setImages] = useState<readonly (LoadedQuestionImage | null)[]>([]);
  const [state, setState] = useState<'loading' | 'missing' | 'failed' | 'ready'>('loading');
  const [zoom, setZoom] = useState<number | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true, failed = false;
    const fail = (index?: number) => {
      if (!active) return;
      failed = true; setState('failed');
      if (index !== undefined) setImages(old => old.map((image, i) => i === index ? null : image));
    };
    setState('loading'); setManifest(null); setImages([]); setZoom(null);
    void (async () => {
      try {
        const metadata = await shell.questionAttachments(questionId);
        if (!active) return;
        if (!metadata) { setState('missing'); return; }
        if (!isStoredQuestionAttachmentManifest(metadata) || 'deletedAt' in metadata || metadata.questionId !== questionId || metadata.images.length !== inputImageCount) throw new Error('invalid_question_attachments');
        setManifest(metadata); setImages(metadata.images.map(() => null));
        let next = 0;
        const worker = async () => {
          while (active && next < metadata.images.length) {
            const index = next++;
            try {
              const value = await shell.questionAttachment({ questionId, index });
              if (!active) return;
              const checked = validateImages([value])?.[0], expected = metadata.images[index];
              if (!checked || checked.name !== expected.name || checked.type !== expected.type || checked.size !== expected.size) throw new Error('invalid_question_attachments');
              setImages(old => old.map((image, i) => i === index ? { image: checked, onDecodeError: () => fail(index) } : image));
            } catch { fail(); }
          }
        };
        // Read at most two bounded original payloads concurrently; unmount stops queued work.
        await Promise.all([worker(), worker()]);
        if (active) setState(failed ? 'failed' : 'ready');
      } catch { fail(); }
    })();
    return () => { active = false; };
  }, [questionId, inputImageCount, attempt]);
  const fetch = async () => {
    setState('loading');
    try { if (!await shell.questionFetchAttachments?.(questionId)) { setState('missing'); return; } setAttempt(value => value + 1); }
    catch { setState('failed'); }
  };
  return <section className="question-attachments" aria-label={copy.questionOriginals} aria-busy={state === 'loading'}>
    {!imageSyncEnabled && <p className="question-note">{copy.questionOriginalsLocal}</p>}
    <ol>{manifest?.images.map((item, index) => <li key={index}>
      <button type="button" data-image-index={index} disabled={!images[index]}
        aria-label={formatCopy(copy.questionOriginalZoom, { number: index + 1, name: item.name })} onClick={event => { event.currentTarget.focus(); setZoom(index); }}>
        {images[index] ? <img src={images[index]!.image.dataUrl} alt={item.name} onError={images[index]!.onDecodeError} /> : <span>{item.name}</span>}
      </button>
    </li>)}</ol>
    {state !== 'ready' && <p role={state === 'loading' ? 'status' : 'alert'}>
      {state === 'loading' ? copy.questionOriginalsLoading : state === 'missing' ? copy.questionOriginalsMissing : copy.questionOriginalsFailed}
      {state !== 'loading' && <button type="button" onClick={() => setAttempt(v => v + 1)}>{copy.questionRetry}</button>}
      {state !== 'loading' && imageSyncEnabled && shell.questionFetchAttachments && <button type="button" onClick={() => { void fetch(); }}>{copy.questionOriginalFetch}</button>}
    </p>}
    <p className="question-note">{copy.questionOriginalResults}</p>
    {zoom !== null && images[zoom] && <QuestionImageDialog image={images[zoom]!.image} number={zoom + 1} count={inputImageCount} copy={copy} onClose={() => setZoom(null)} />}
  </section>;
}
