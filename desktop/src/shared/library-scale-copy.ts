import { resolveLocale } from './locale';

export const LIBRARY_SCALE_COPY = {
  en: {
    sort: 'Sort', updated: 'Updated, newest first', created: 'Created, newest first', title: 'Title, A–Z',
    page: 'Page', range: '{start}–{end} of {total}', previous: 'Previous page', next: 'Next page',
    selectPage: 'Select this page', clearSelection: 'Clear selection', selectItem: 'Select {title}',
    selected: '{count} selected / {total} matching', folderSearch: 'Find a folder', folderCountUnknown: 'Count unavailable',
    bulkAddFolder: 'Add to folders', bulkFavorite: 'Favorite', bulkUnfavorite: 'Remove favorites', bulkExport: 'Export selected',
    favoriteOnly: 'Favorites apply to saved results only.', bulkStop: 'Stop after current item', bulkRetry: 'Retry failed items',
    bulkResult: '{succeeded} succeeded · {failed} failed · {stopped} stopped', bulkRunning: '{done} / {total} processed',
    bulkScope: '{count} selected items', folderConfirm: 'Add selected items', exportIncomplete: 'No file was downloaded. Retry failed items to complete the export.',
  },
  zhCN: {
    sort: '排序', updated: '最近更新优先', created: '最近创建优先', title: '标题顺序',
    page: '页码', range: '第 {start}–{end} 条，共 {total} 条', previous: '上一页', next: '下一页',
    selectPage: '选择本页', clearSelection: '清除选择', selectItem: '选择「{title}」',
    selected: '已选 {count} 条 / 匹配 {total} 条', folderSearch: '查找文件夹', folderCountUnknown: '数量暂不可用',
    bulkAddFolder: '归入文件夹', bulkFavorite: '收藏', bulkUnfavorite: '取消收藏', bulkExport: '导出所选',
    favoriteOnly: '收藏仅适用于已保存的结果。', bulkStop: '当前条目完成后停止', bulkRetry: '重试失败条目',
    bulkResult: '{succeeded} 条成功 · {failed} 条失败 · {stopped} 条已停止', bulkRunning: '已处理 {done} / {total} 条',
    bulkScope: '已选 {count} 条', folderConfirm: '加入所选条目', exportIncomplete: '尚未下载文件。重试失败条目后可完成导出。',
  },
  zhTW: {
    sort: '排序', updated: '最近更新優先', created: '最近建立優先', title: '標題順序',
    page: '頁碼', range: '第 {start}–{end} 筆，共 {total} 筆', previous: '上一頁', next: '下一頁',
    selectPage: '選取本頁', clearSelection: '清除選取', selectItem: '選取「{title}」',
    selected: '已選 {count} 筆 / 符合 {total} 筆', folderSearch: '尋找資料夾', folderCountUnknown: '數量暫不可用',
    bulkAddFolder: '加入資料夾', bulkFavorite: '收藏', bulkUnfavorite: '取消收藏', bulkExport: '匯出所選',
    favoriteOnly: '收藏僅適用於已儲存的結果。', bulkStop: '目前項目完成後停止', bulkRetry: '重試失敗項目',
    bulkResult: '{succeeded} 筆成功 · {failed} 筆失敗 · {stopped} 筆已停止', bulkRunning: '已處理 {done} / {total} 筆',
    bulkScope: '已選 {count} 筆', folderConfirm: '加入所選項目', exportIncomplete: '尚未下載檔案。重試失敗項目後可完成匯出。',
  },
};
export type LibraryCopy = typeof LIBRARY_SCALE_COPY.en;
export const getLibraryCopy = (locale: string): LibraryCopy => LIBRARY_SCALE_COPY[resolveLocale(locale)];
