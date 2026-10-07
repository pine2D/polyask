import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownPreview } from '../../src/renderer/markdown-preview';
import { getCopy } from '../../src/shared/copy';
import '../../src/renderer/styles.css';

const locale = new URLSearchParams(location.search).get('locale') ?? 'en';
document.documentElement.lang = locale;
const copy = getCopy(locale), root = createRoot(document.getElementById('root')!);
function setValue(value: string) {
  root.render(<StrictMode><main id="technical-reading" style={{ height: '100%', overflow: 'auto', padding: '24px', fontSize: '16px' }}>
    <MarkdownPreview value={value} onOpenLink={() => { throw Error('a blocked link must not open'); }} />
  </main></StrictMode>);
}
(window as any).technicalReading = {
  setValue, labels: { copy: copy.readingCopyCode, copied: copy.readingCodeCopied, highlight: copy.readingHighlight,
    plain: copy.readingPlainCode, preview: copy.readingFormulaPreview, source: copy.readingFormulaSource,
    failed: copy.readingFormulaFailed, limit: copy.readingFormulaLimit, unsupported: copy.readingFormulaUnsupported }
};
setValue('```js\n\tconst x = "<script>";\n```');
