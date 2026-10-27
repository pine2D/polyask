export const COMMAND_PALETTE_SHORTCUT_COPY = {
  en: {
    commandShortcutTitle: 'Command palette shortcut', commandShortcutDescription: 'Applies immediately on this device only.',
    commandShortcutCombination: 'Shortcut', commandShortcutConflict: 'Overrides the page’s print command or other use of this shortcut.',
    commandShortcutLoading: 'Loading shortcut…', commandShortcutReadFailed: 'Could not read the current shortcut. Try again.',
    commandShortcutSaveFailed: 'Could not save the shortcut. The previous shortcut is still active.',
    commandShortcutApplyFailed: 'Could not apply the shortcut. The previous shortcut is still active.'
  },
  zhCN: {
    commandShortcutTitle: '命令面板快捷键', commandShortcutDescription: '仅在本机生效，选择后立即应用。',
    commandShortcutCombination: '快捷键', commandShortcutConflict: '会覆盖网页内的打印或同名快捷键。',
    commandShortcutLoading: '正在读取快捷键…', commandShortcutReadFailed: '未能读取当前快捷键，请重试。',
    commandShortcutSaveFailed: '快捷键保存失败，仍使用原快捷键。', commandShortcutApplyFailed: '快捷键应用失败，仍使用原快捷键。'
  },
  zhTW: {
    commandShortcutTitle: '命令面板快速鍵', commandShortcutDescription: '僅在本機生效，選擇後立即套用。',
    commandShortcutCombination: '快速鍵', commandShortcutConflict: '會覆蓋網頁內的列印或同名快速鍵。',
    commandShortcutLoading: '正在讀取快速鍵…', commandShortcutReadFailed: '未能讀取目前快速鍵，請重試。',
    commandShortcutSaveFailed: '快速鍵儲存失敗，仍使用原快速鍵。', commandShortcutApplyFailed: '快速鍵套用失敗，仍使用原快速鍵。'
  }
} as const;
