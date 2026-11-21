export const NOTIFICATION_COPY = {
  en: {
    notificationSummary: 'This round: {complete} done · {failed} need attention',
    notificationAttention: '{site} needs attention. Switch to PolyAsk to check.',
    notificationTest: 'Send test notification',
    notificationTestBody: 'Test notification from PolyAsk.',
    notificationIdle: 'Check system notification permissions and banner display.',
    notificationRequested: 'Sent to system; waiting for response…',
    notificationShown: 'Test alert sent. If nothing popped up, check system notification permissions and Focus / Do Not Disturb.',
    notificationUnknown: 'No response from the system yet. Check notification and Do Not Disturb settings, then retry.',
    notificationFailed: 'Blocked by the system. Check system notification permissions and try again.',
    notificationUnsupported: 'System notifications are not supported in this environment.',
    notificationOpenBlocked: 'Finish the current action or close the dialog first.',
    notificationOpenUnavailable: 'That saved question or site chat is no longer available.'
  },
  zhCN: {
    notificationSummary: '本轮提问：{complete} 站已完成 · {failed} 站待处理',
    notificationAttention: '{site} 需要处理，回到 PolyAsk 查看。',
    notificationTest: '发送测试通知',
    notificationTestBody: '来自 PolyAsk 的测试通知。',
    notificationIdle: '检查系统通知权限与桌面弹窗显示。',
    notificationRequested: '已发出请求，等待系统响应…',
    notificationShown: '已触发系统通知。若没看到弹窗，检查系统通知权限与勿扰模式。',
    notificationUnknown: '暂未收到系统响应，检查系统通知与勿扰设置后再试。',
    notificationFailed: '系统未允许弹出通知，检查系统通知权限后再试。',
    notificationUnsupported: '当前运行环境不支持系统通知。',
    notificationOpenBlocked: '先完成当前操作或关掉确认框，再打开通知对应内容。',
    notificationOpenUnavailable: '该通知对应的记录或原站对话已不存在。'
  },
  zhTW: {
    notificationSummary: '本輪提問：{complete} 站已完成 · {failed} 站待處理',
    notificationAttention: '{site} 需要處理，回到 PolyAsk 查看。',
    notificationTest: '傳送測試通知',
    notificationTestBody: '來自 PolyAsk 的測試通知。',
    notificationIdle: '檢查系統通知權限與桌面提醒顯示。',
    notificationRequested: '已發出請求，等待系統回應…',
    notificationShown: '已觸發系統通知。若沒看到提醒，檢查系統通知權限與勿擾模式。',
    notificationUnknown: '尚未收到系統回應，檢查系統通知與勿擾設定後再試。',
    notificationFailed: '系統未允許顯示通知，檢查系統通知權限後再試。',
    notificationUnsupported: '目前執行環境不支援系統通知。',
    notificationOpenBlocked: '先完成目前操作或關掉確認視窗，再開啟此通知。',
    notificationOpenUnavailable: '此通知對應的紀錄或原網站對話已不存在。'
  }
} as const;
export type NotificationCopy = { readonly [Key in keyof typeof NOTIFICATION_COPY.en]: string };
