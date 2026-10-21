/** Bound encoded image records before allocating/parsing the JSON body. */
export async function boundedResponseText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const invalid = () => Object.assign(new Error('invalid_response'), { code: 'invalid_response', status: response.status });
  if (Number(response.headers.get('Content-Length')) > maxBytes) { await response.body?.cancel(); throw invalid(); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
