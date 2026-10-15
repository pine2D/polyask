import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LibraryMenu } from '../../src/renderer/library-menu';
import { LibrarySelect } from '../../src/renderer/library-select';
import { getCopy } from '../../src/shared/copy';
import '../../src/renderer/styles.css';

const params = new URLSearchParams(location.search), locale = params.get('locale') ?? 'en';
document.documentElement.lang = locale;
document.documentElement.dataset.platform = 'linux';
const copy = getCopy(locale), above = params.get('placement') === 'above', menu = params.get('kind') === 'menu';
const result = { changes: 0, value: '', disable: () => {}, disabledDuringEntry: false,
  lastKey: null as { trusted: boolean; key: string; tag: string; entering: boolean } | null };
Object.assign(window, { libraryMotion: result });
// 先于组件监听原生输入；浮层会在 window 捕获阶段消费 Escape。
window.addEventListener('keydown', event => {
  result.lastKey = { trusted: event.isTrusted, key: event.key, tag: (event.target as HTMLElement).tagName,
    entering: document.querySelector('.library-popover')?.getAnimations().some(animation => animation.playState === 'running') ?? false };
}, true);

function Fixture() {
  const [value, setValue] = useState('all'), [disabled, setDisabled] = useState(false);
  result.disable = () => {
    result.disabledDuringEntry = document.querySelector('.library-popover')?.getAnimations().some(animation => animation.playState === 'running') ?? false;
    setDisabled(true);
  };
  const change = (next: string) => { result.changes++; result.value = next; setValue(next); };
  return <main className="library" style={{ height: '100%', padding: 24 }}>
    <h1 style={{ fontSize: 20 }}>PolyAsk · {copy.archiveTitle}</h1>
    <p data-stationary>{copy.libraryPickHint}</p>
    <div style={{ position: 'fixed', width: 170, ...(above ? { bottom: 24, right: 16 } : { top: 96, left: 16 }) }}>
      {menu ? <LibraryMenu label={copy.libraryMore} actions={[
        { label: copy.copyArchive, run: () => change('copy') },
        { label: copy.exportArchive, run: () => change('export') },
        { label: copy.deleteArchive, run: () => change('delete'), danger: true }
      ]} disabled={disabled} /> : <LibrarySelect label={copy.archiveTags} value={value} onChange={change} disabled={disabled}
        searchLabel={copy.librarySearchOptions} emptyLabel={copy.archiveNoMatches} options={[
          { value: 'all', label: copy.allArchiveTags }, { value: 'work', label: 'Work' },
          { value: 'study', label: 'Study' }, { value: 'unavailable', label: 'Unavailable', disabled: true }
        ]} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
