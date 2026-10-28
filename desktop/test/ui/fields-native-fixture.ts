// Only synthetic inputs and production global styles; no shell bridge or account data.
import '../../src/renderer/styles.css';
import '../../src/renderer/settings.css';
import '../../src/renderer/accessibility.css';
import '../../src/renderer/feedback.css';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') || 'en';
document.documentElement.lang = locale;
document.documentElement.dataset.density = query.get('density') || 'compact';
document.documentElement.dataset.platform = 'linux';
const labels = locale === 'en'
  ? ['Synthetic input states', 'Search', 'Notes', 'Read only', 'Invalid value', 'Disabled', 'Prompt', 'Popover search']
  : locale === 'zh-TW'
    ? ['合成輸入狀態', '搜尋', '備註', '唯讀', '無效值', '已停用', '提問', '彈出層搜尋']
    : ['合成输入状态', '搜索', '备注', '只读', '无效值', '已停用', '提问', '弹出层搜索'];
const style = document.createElement('style');
style.textContent = `
  body { overflow: auto; }
  #root { height: auto; padding: 20px; overflow: visible; }
  .field-fixture { max-width: 780px; margin: auto; }
  .field-fixture h1 { font-size: 18px; margin: 0 0 16px; }
  .field-fixture section, .field-fixture.library-popover { padding: 16px; background: var(--panel); }
  .field-fixture section { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 20px; }
  .field-fixture label { display: grid; min-width: 0; gap: 6px; }
  .field-fixture input, .field-fixture textarea { width: 100%; min-width: 0; height: var(--control-height); padding: 5px 8px; }
  .field-fixture textarea { resize: none; }
  .field-fixture .command-bar { display: block; padding: 0; height: auto; border: 0; grid-column: 1 / -1; }
  .field-fixture .prompt-composer { margin: 0; }
  .field-fixture.library-popover { position: static; margin: 16px auto; width: auto; border: 0; box-shadow: none; }
`;
document.head.append(style);
document.querySelector('#root')!.innerHTML = `<main class="field-fixture">
  <h1>${labels[0]}</h1><section>
    <label>${labels[1]}<input id="normal" type="search" placeholder="${labels[1]}" /></label>
    <label>${labels[2]}<textarea id="notes">${labels[2]}</textarea></label>
    <label>${labels[3]}<input id="readonly" value="Synthetic" readonly /></label>
    <label>${labels[4]}<input id="invalid" value="Synthetic" aria-invalid="true" /></label>
    <label>${labels[5]}<input id="disabled" value="Synthetic" disabled /></label>
    <div class="command-bar"><label>${labels[6]}<div class="prompt-composer"><textarea name="prompt">${labels[6]}</textarea></div></label></div>
  </section></main>`;
const popover = document.createElement('aside');
popover.className = 'field-fixture library-popover';
popover.innerHTML = `<label>${labels[7]}<input id="popover" type="search" placeholder="${labels[7]}" /></label>`;
document.body.append(popover);
