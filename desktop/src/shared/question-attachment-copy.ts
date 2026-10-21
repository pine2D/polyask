export const QUESTION_ATTACHMENT_COPY = {
  en: {
    questionOriginals: 'Original images', questionOriginalsLoading: 'Loading original images…',
    questionOriginalsMissing: 'Original images were not saved or have not synced to this device. Your draft is unchanged.',
    questionOriginalsFailed: 'Original images could not be read. Your draft is unchanged.',
    questionOriginalsLocal: 'Image sync is off on this device. New original images are saved locally.',
    questionOriginalZoom: 'Enlarge image {number}: {name}', questionOriginalClose: 'Close image preview',
    questionOriginalFetch: 'Download originals', questionOriginalTextOnly: 'Use text only',
    questionOriginalTextWarning: 'Only the question text will be restored. Add any needed images before sending.',
    questionOriginalReplace: 'Replace the current text and attachments with this saved question? It will not be sent.',
    questionOriginalSaveFailed: 'Could not save original images. The question is saved and sending continues.',
    questionOriginalResults: 'Saving to results includes question text and answer copies; original images stay in question history.',
    questionReaskLoading: 'Preparing question draft…'
  },
  zhCN: {
    questionOriginals: '原始图片', questionOriginalsLoading: '正在读取原图…',
    questionOriginalsMissing: '原图未保存或尚未同步到本机，当前草稿未改动。',
    questionOriginalsFailed: '原图读取失败，当前草稿未改动。',
    questionOriginalsLocal: '本机未开启图片同步，新提问的原图仅保存在本机。',
    questionOriginalZoom: '放大第 {number} 张图片：{name}', questionOriginalClose: '关闭图片预览',
    questionOriginalFetch: '下载原图', questionOriginalTextOnly: '仅使用文字',
    questionOriginalTextWarning: '仅恢复提问文字，请在发送前补充所需图片。',
    questionOriginalReplace: '将用这条历史提问替换当前草稿的文字和附件，不会发送。',
    questionOriginalSaveFailed: '原图保存失败，提问已保存，发送继续。',
    questionOriginalResults: '保存到结果库仅包含提问文字和回答副本，原图仍保留在提问历史中。',
    questionReaskLoading: '正在准备提问草稿…'
  },
  zhTW: {
    questionOriginals: '原始圖片', questionOriginalsLoading: '正在讀取原圖…',
    questionOriginalsMissing: '原圖未儲存或尚未同步到本機，目前草稿未變更。',
    questionOriginalsFailed: '原圖讀取失敗，目前草稿未變更。',
    questionOriginalsLocal: '本機未開啟圖片同步，新提問的原圖僅儲存在本機。',
    questionOriginalZoom: '放大第 {number} 張圖片：{name}', questionOriginalClose: '關閉圖片預覽',
    questionOriginalFetch: '下載原圖', questionOriginalTextOnly: '僅使用文字',
    questionOriginalTextWarning: '僅還原提問文字，請在傳送前補上所需圖片。',
    questionOriginalReplace: '將以這條歷史提問取代目前草稿的文字與附件，不會傳送。',
    questionOriginalSaveFailed: '原圖儲存失敗，提問已儲存，傳送繼續。',
    questionOriginalResults: '儲存至結果庫僅包含提問文字與回答副本，原圖仍保留在提問歷史中。',
    questionReaskLoading: '正在準備提問草稿…'
  }
} as const;
