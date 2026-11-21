export const QUESTION_OBSERVATION_COPY = {
  en: {
    observationTitle: 'Observed on page', observationMissing: 'Not recorded',
    observationAt: 'Recorded {time}',
    observationNote: 'Recorded from the webpage UI at send time; does not guarantee the server-side model.'
  },
  zhCN: {
    observationTitle: '发送时网页显示', observationMissing: '未记录',
    observationAt: '记录于 {time}',
    observationNote: '记录发送时网页界面显示的名称或档位，不代表服务端实际调用的模型。'
  },
  zhTW: {
    observationTitle: '傳送時網頁顯示', observationMissing: '未記錄',
    observationAt: '記錄於 {time}',
    observationNote: '記錄傳送時網頁介面顯示的名稱或模式，不代表伺服器端實際呼叫的模型。'
  }
} as const;
