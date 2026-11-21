export const COMMAND_PALETTE_SHORTCUT_COPY = {
  en: {
    commandShortcutTitle: 'Command palette shortcut', commandShortcutDescription: 'This device only.',
    commandShortcutCombination: 'Shortcut', commandShortcutConflict: 'Replaces in-page Print (Ctrl+P / Cmd+P).',
    commandShortcutLoading: 'Loading shortcut…', commandShortcutReadFailed: 'Could not read shortcut.',
    commandShortcutSaveFailed: 'Could not save shortcut; keeping previous binding.',
    commandShortcutApplyFailed: 'Could not apply shortcut; keeping previous binding.'
  },
  zhCN: {
    commandShortcutTitle: '命令面板快捷键', commandShortcutDescription: '仅存本机。',
    commandShortcutCombination: '组合键', commandShortcutConflict: '会接管网页内的打印快捷键（Ctrl+P / Cmd+P）。',
    commandShortcutLoading: '正在读取…', commandShortcutReadFailed: '读取快捷键失败。',
    commandShortcutSaveFailed: '保存失败，仍保留原快捷键。', commandShortcutApplyFailed: '应用失败，仍保留原快捷键。'
  },
  zhTW: {
    commandShortcutTitle: '指令面板快速鍵', commandShortcutDescription: '僅存本機。',
    commandShortcutCombination: '按鍵組合', commandShortcutConflict: '會接管網頁內的列印快速鍵（Ctrl+P / Cmd+P）。',
    commandShortcutLoading: '正在讀取…', commandShortcutReadFailed: '讀取快速鍵失敗。',
    commandShortcutSaveFailed: '儲存失敗，仍保留原快速鍵。', commandShortcutApplyFailed: '套用失敗，仍保留原快速鍵。'
  }
} as const;
