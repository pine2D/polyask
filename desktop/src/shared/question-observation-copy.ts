export const QUESTION_OBSERVATION_COPY = {
  en: {
    observationTitle: 'Webpage observation', observationMissing: 'Not recorded',
    observationAt: 'Observed at {time}',
    observationNote: 'Recorded from the webpage during this attempt; it does not verify the server-side model.'
  },
  zhCN: {
    observationTitle: '网页观测', observationMissing: '未记录',
    observationAt: '观测时间：{time}',
    observationNote: '记录本次尝试时网页显示的模型或档位，不代表服务端实际使用的模型。'
  },
  zhTW: {
    observationTitle: '網頁觀測', observationMissing: '未記錄',
    observationAt: '觀測時間：{time}',
    observationNote: '記錄本次嘗試時網頁顯示的模型或檔位，不代表伺服器端實際使用的模型。'
  }
} as const;
