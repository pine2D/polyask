export const CONFIRMATION_COPY = {
  en: {
    confirmDontAsk: "Don't ask again",
    confirmationsTitle: 'Confirmations',
    sitePageCloseConfirmSetting: 'Confirm before closing a site page',
    sitePageCloseConfirmSettingHint: 'When off, closing skips the dialog. Pages that are sending, generating or saving an answer are still protected. Shared preference; applies when Google Drive sync is connected.',
    newSessionConfirmSetting: 'Confirm before starting new sessions',
    newSessionConfirmSettingHint: 'When off, starting new sessions opens blank conversations right away. Earlier conversations stay in each site\'s history. Shared preference; applies when Google Drive sync is connected.'
  },
  zhCN: {
    confirmDontAsk: '不再提示',
    confirmationsTitle: '确认提示',
    sitePageCloseConfirmSetting: '关闭站点页面前确认',
    sitePageCloseConfirmSettingHint: '关掉此项后，点 × 会直接关闭页面；正在发送、生成或保存回答的页面仍会被拦下。共享偏好，连接 Google Drive 同步后应用。',
    newSessionConfirmSetting: '新建会话前确认',
    newSessionConfirmSettingHint: '关掉此项后，新建会话会直接打开空白对话；原来的对话仍在各站历史里。共享偏好，连接 Google Drive 同步后应用。'
  },
  zhTW: {
    confirmDontAsk: '不再提示',
    confirmationsTitle: '確認提示',
    sitePageCloseConfirmSetting: '關閉站點頁面前確認',
    sitePageCloseConfirmSettingHint: '關掉此項後，點 × 會直接關閉頁面；正在傳送、生成或儲存回答的頁面仍會被攔下。共用偏好，連線 Google Drive 同步後套用。',
    newSessionConfirmSetting: '新增對話前確認',
    newSessionConfirmSettingHint: '關掉此項後，新增對話會直接開啟空白對話；原本的對話仍在各站歷史裡。共用偏好，連線 Google Drive 同步後套用。'
  }
} as const;
