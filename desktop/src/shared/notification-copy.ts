export const NOTIFICATION_COPY = {
  en: {
    notificationSummary: 'This question: {complete} finished; {failed} need attention.',
    notificationAttention: '{site} needs attention. Open PolyAsk to check its status.',
    notificationTest: 'Test notification',
    notificationTestBody: 'This is a test notification from PolyAsk.',
    notificationTestHint: 'Testing does not change the notification setting.',
    notificationIdle: 'Test whether this device can display system notifications.',
    notificationRequested: 'Notification requested. Waiting for the system to report the result.',
    notificationShown: 'The system reported displaying the notification. If you did not see it, check notification and Do Not Disturb settings.',
    notificationUnknown: 'The system has not confirmed display. Check notification and Do Not Disturb settings, then try again.',
    notificationFailed: 'The system could not display the notification. Check system notification settings, then try again.',
    notificationUnsupported: 'System notifications are unavailable in this environment.',
    notificationOpenBlocked: 'Finish the current action or close the confirmation before opening this notification.',
    notificationOpenUnavailable: 'This notification’s saved question or original site session is no longer available.'
  },
  zhCN: {
    notificationSummary: '本轮提问：{complete} 站已完成，{failed} 站需要处理。',
    notificationAttention: '{site} 需要处理，请回到 PolyAsk 查看状态。',
    notificationTest: '测试通知',
    notificationTestBody: '这是一条来自 PolyAsk 的测试通知。',
    notificationTestHint: '测试不会改变通知开关。',
    notificationIdle: '测试这台设备能否显示系统通知。',
    notificationRequested: '已请求显示通知，等待系统返回结果。',
    notificationShown: '系统报告已显示通知。若没有看到，请检查系统通知和勿扰设置。',
    notificationUnknown: '系统尚未确认是否显示通知。请检查系统通知和勿扰设置后重试。',
    notificationFailed: '系统未能显示通知。请检查系统通知设置后重试。',
    notificationUnsupported: '当前环境不支持系统通知。',
    notificationOpenBlocked: '请先完成当前操作或关闭确认框，再打开这条通知。',
    notificationOpenUnavailable: '这条通知对应的已保存提问或原站点会话已不可用。'
  },
  zhTW: {
    notificationSummary: '本輪提問：{complete} 站已完成，{failed} 站需要處理。',
    notificationAttention: '{site} 需要處理，請回到 PolyAsk 查看狀態。',
    notificationTest: '測試通知',
    notificationTestBody: '這是一則來自 PolyAsk 的測試通知。',
    notificationTestHint: '測試不會變更通知開關。',
    notificationIdle: '測試這台裝置能否顯示系統通知。',
    notificationRequested: '已要求顯示通知，等待系統回報結果。',
    notificationShown: '系統回報已顯示通知。若沒有看到，請檢查系統通知與勿擾設定。',
    notificationUnknown: '系統尚未確認是否顯示通知。請檢查系統通知與勿擾設定後重試。',
    notificationFailed: '系統未能顯示通知。請檢查系統通知設定後重試。',
    notificationUnsupported: '目前環境不支援系統通知。',
    notificationOpenBlocked: '請先完成目前的操作或關閉確認視窗，再開啟這則通知。',
    notificationOpenUnavailable: '這則通知對應的已儲存提問或原網站對話已無法使用。'
  }
} as const;
export type NotificationCopy = { readonly [Key in keyof typeof NOTIFICATION_COPY.en]: string };
