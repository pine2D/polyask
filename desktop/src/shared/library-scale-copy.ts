import { resolveLocale } from './locale';

export const LIBRARY_SCALE_COPY = {
  en: {
    filters: 'Filters', filtersActive: 'Filters · {count}', multiSelect: 'Select',
    sort: 'Sort', updated: 'Recently updated', created: 'Recently created', title: 'Title A–Z',
    page: 'Page', range: '{start}–{end} of {total}', previous: 'Previous page', next: 'Next page',
    selectPage: 'Select page', clearSelection: 'Clear', selectItem: 'Select {title}',
    selected: '{count} selected · {total} matching', folderSearch: 'Find folder', folderCountUnknown: 'Count unavailable',
    bulkAddFolder: 'Add to folders', bulkFavorite: 'Star', bulkUnfavorite: 'Unstar', bulkExport: 'Merge into .md',
    bulkStop: 'Stop after current', bulkRetry: 'Retry failed',
    bulkResult: '{succeeded} done · {failed} failed · {stopped} stopped', bulkRunning: '{done} / {total}',
    bulkScope: '{count} selected', folderConfirm: 'Add to folders', exportIncomplete: 'Export paused on errors; retry failed items to save the file.',
  },
  zhCN: {
    filters: '筛选', filtersActive: '筛选 · {count}', multiSelect: '多选',
    sort: '排序', updated: '按最近修改', created: '按创建时间', title: '按标题排序',
    page: '页码', range: '第 {start}–{end} / {total} 条', previous: '上一页', next: '下一页',
    selectPage: '全选本页', clearSelection: '清空', selectItem: '选择「{title}」',
    selected: '已选 {count} · 匹配 {total}', folderSearch: '搜索文件夹', folderCountUnknown: '条数暂未知',
    bulkAddFolder: '归入文件夹', bulkFavorite: '添加星标', bulkUnfavorite: '取消星标', bulkExport: '合并导出 .md',
    bulkStop: '停止后续', bulkRetry: '重试失败项',
    bulkResult: '成功 {succeeded} · 失败 {failed} · 已停 {stopped}', bulkRunning: '正在处理 {done} / {total}',
    bulkScope: '已选 {count} 条', folderConfirm: '确认归入', exportIncomplete: '有条目读取失败，文件尚未写出；重试失败项即可完成导出。',
  },
  zhTW: {
    filters: '篩選', filtersActive: '篩選 · {count}', multiSelect: '多選',
    sort: '排序', updated: '依最近修改', created: '依建立時間', title: '依標題排序',
    page: '頁碼', range: '第 {start}–{end} / {total} 筆', previous: '上一頁', next: '下一頁',
    selectPage: '全選本頁', clearSelection: '清除', selectItem: '選取「{title}」',
    selected: '已選 {count} · 相符 {total}', folderSearch: '搜尋資料夾', folderCountUnknown: '筆數暫未知',
    bulkAddFolder: '歸入資料夾', bulkFavorite: '加上星號', bulkUnfavorite: '移除星號', bulkExport: '合併匯出 .md',
    bulkStop: '停止後續', bulkRetry: '重試失敗項',
    bulkResult: '成功 {succeeded} · 失敗 {failed} · 已停 {stopped}', bulkRunning: '正在處理 {done} / {total}',
    bulkScope: '已選 {count} 筆', folderConfirm: '確認歸入', exportIncomplete: '有項目讀取失敗，檔案尚未寫出；重試失敗項即可完成匯出。',
  },
};
export type LibraryCopy = typeof LIBRARY_SCALE_COPY.en;
export const getLibraryCopy = (locale: string): LibraryCopy => LIBRARY_SCALE_COPY[resolveLocale(locale)];
