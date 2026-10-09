export const DRAFT_COPY = {
  en: {
    draftRecovery: 'Saved drafts', draftRecoveryCount: 'Saved drafts ({count})', draftLocal: 'This device',
    draftRemote: 'Another device', draftBackup: 'Imported backup', draftUntitled: 'Untitled draft',
    draftReview: 'Review draft', draftRestore: 'Restore draft', draftRemove: 'Delete draft',
    draftPreview: 'Draft contents', draftEmpty: 'This draft is empty.', draftNoCopies: 'No saved drafts for this editor.',
    draftLoading: 'Loading drafts…', draftSaving: 'Saving draft…', draftSaved: 'Draft saved on this device.',
    draftSaveFailed: 'Could not save the draft. Your edits are kept in this editor.', draftRetry: 'Try saving again',
    draftRestoreConfirm: 'Replace your current edits with this draft?', draftKeepEditing: 'Keep current edits',
    draftRemoveConfirm: 'Delete this draft copy?', draftRemoveHint: 'Other draft copies will be kept.',
    draftSourceChanged: 'The saved source has changed. Review its excerpts and references before using this draft.',
    draftRestoreFailed: 'This draft could not be restored. Review the current saved source and try again.',
    draftRemoveFailed: 'This draft changed or could not be deleted. Review the latest copy and try again.',
    draftSyncLabel: 'Sync drafts between devices', draftSyncHint: 'Off by default. Turning it off keeps existing cloud copies.',
    draftPrompt: 'Prompt', draftComparison: 'Manual comparison', draftDecision: 'Decision', draftSynthesis: 'Synthesis and follow-up',
    draftFormSaved: 'Saved draft', draftReviewChanged: 'This draft has changed. Review its latest contents.', draftTimeUnavailable: 'Time unavailable'
  },
  zhCN: {
    draftRecovery: '保存的草稿', draftRecoveryCount: '保存的草稿（{count}）', draftLocal: '本机',
    draftRemote: '另一设备', draftBackup: '导入的备份', draftUntitled: '未命名草稿',
    draftReview: '查看草稿', draftRestore: '恢复草稿', draftRemove: '删除草稿',
    draftPreview: '草稿内容', draftEmpty: '这份草稿为空。', draftNoCopies: '当前编辑器没有保存的草稿。',
    draftLoading: '正在读取草稿…', draftSaving: '正在保存草稿…', draftSaved: '草稿已保存到本机。',
    draftSaveFailed: '草稿保存失败，已写内容仍保留在当前编辑器。', draftRetry: '重新保存',
    draftRestoreConfirm: '用这份草稿替换当前编辑内容？', draftKeepEditing: '保留当前编辑',
    draftRemoveConfirm: '删除这份草稿副本？', draftRemoveHint: '其它草稿副本会保留。',
    draftSourceChanged: '保存来源已变更，使用草稿前请重新核对摘录及关联。',
    draftRestoreFailed: '草稿恢复失败，请核对当前保存来源后重试。',
    draftRemoveFailed: '草稿已变更或删除失败，请核对最新副本后重试。',
    draftSyncLabel: '跨设备同步草稿', draftSyncHint: '默认关闭，关闭后会保留已有云端副本。',
    draftPrompt: '提问', draftComparison: '人工对照', draftDecision: '决策', draftSynthesis: '综合与追问',
    draftFormSaved: '已保存草稿', draftReviewChanged: '这份草稿已变更，请重新查看最新内容。', draftTimeUnavailable: '时间不可用'
  },
  zhTW: {
    draftRecovery: '儲存的草稿', draftRecoveryCount: '儲存的草稿（{count}）', draftLocal: '本機',
    draftRemote: '另一裝置', draftBackup: '匯入的備份', draftUntitled: '未命名草稿',
    draftReview: '檢視草稿', draftRestore: '還原草稿', draftRemove: '刪除草稿',
    draftPreview: '草稿內容', draftEmpty: '這份草稿為空。', draftNoCopies: '目前編輯器沒有儲存的草稿。',
    draftLoading: '正在讀取草稿…', draftSaving: '正在儲存草稿…', draftSaved: '草稿已儲存到本機。',
    draftSaveFailed: '草稿儲存失敗，已寫內容仍保留在目前編輯器。', draftRetry: '重新儲存',
    draftRestoreConfirm: '用這份草稿取代目前編輯內容？', draftKeepEditing: '保留目前編輯',
    draftRemoveConfirm: '刪除這份草稿副本？', draftRemoveHint: '其它草稿副本會保留。',
    draftSourceChanged: '儲存來源已變更，使用草稿前請重新核對摘錄及關聯。',
    draftRestoreFailed: '草稿還原失敗，請核對目前儲存來源後重試。',
    draftRemoveFailed: '草稿已變更或刪除失敗，請核對最新副本後重試。',
    draftSyncLabel: '跨裝置同步草稿', draftSyncHint: '預設關閉，關閉後會保留已有雲端副本。',
    draftPrompt: '提問', draftComparison: '人工對照', draftDecision: '決策', draftSynthesis: '綜合與追問',
    draftFormSaved: '已儲存草稿', draftReviewChanged: '這份草稿已變更，請重新檢視最新內容。', draftTimeUnavailable: '時間無法使用'
  }
} as const;

export type DraftCopy = { readonly [Key in keyof typeof DRAFT_COPY.en]: string };
