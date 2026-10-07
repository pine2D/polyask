export const PAGE_PROGRESS_COPY = {
  en: { runSubmitted: 'Submitted {count}/{total}', runGenerating: 'Generating {count}', runEnded: 'Ended {count}/{total}',
    runSavedComplete: 'Full copies {count}/{total}', runSavedPartial: 'Partial copies {count}', runFailed: 'Failed {count}',
    runUnconfirmed: 'Unconfirmed {count}', runCancelled: 'Cancelled {count}', runCopiesUnavailable: 'Copy status unavailable',
    runReadCopies: 'Read saved copies', runProgressLabel: 'Current broadcast progress',
    runProgressExplanation: 'Submitted means the question reached the site. Ended requires positive generation evidence. Full copies require sealed, untruncated saved text.' },
  zhCN: { runSubmitted: '已提交 {count}/{total}', runGenerating: '生成中 {count}', runEnded: '已结束 {count}/{total}',
    runSavedComplete: '完整副本 {count}/{total}', runSavedPartial: '部分副本 {count}', runFailed: '失败 {count}',
    runUnconfirmed: '未确认 {count}', runCancelled: '已取消 {count}', runCopiesUnavailable: '副本状态暂不可用',
    runReadCopies: '阅读已存副本', runProgressLabel: '本轮群发进度',
    runProgressExplanation: '已提交表示问题到达原站；已结束需要正向生成证据；完整副本需要已封存且未截断的保存正文。' },
  zhTW: { runSubmitted: '已提交 {count}/{total}', runGenerating: '生成中 {count}', runEnded: '已結束 {count}/{total}',
    runSavedComplete: '完整副本 {count}/{total}', runSavedPartial: '部分副本 {count}', runFailed: '失敗 {count}',
    runUnconfirmed: '未確認 {count}', runCancelled: '已取消 {count}', runCopiesUnavailable: '副本狀態暫不可用',
    runReadCopies: '閱讀已存副本', runProgressLabel: '本輪群發進度',
    runProgressExplanation: '已提交表示問題到達原站；已結束需要正向生成證據；完整副本需要已封存且未截斷的儲存內文。' }
} as const;
