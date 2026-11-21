export const COMPOSER_COPY = {
  en: {
    composerExpand: 'Expand prompt', composerCollapse: 'Collapse prompt',
    tierSwitching: 'Switching participating sites to {mode}…',
    tierSwitchDone: 'Switched {count} sites to {mode}',
    tierSwitchPartial: 'Switched {count} sites to {mode}; unconfirmed: {sites}',
    tierFollowing: 'Using each site’s current mode',
    composerNextMode: 'Response mode: {mode} (checked again before sending)',
    composerModeSite: 'Site', composerModeFast: 'Fast', composerModeThink: 'Think'
  },
  zhCN: {
    composerExpand: '展开输入框', composerCollapse: '收起输入框',
    tierSwitching: '正在将参与站点切到「{mode}」…',
    tierSwitchDone: '已将 {count} 个站点切到「{mode}」',
    tierSwitchPartial: '{count} 站已切到「{mode}」；未确认：{sites}',
    tierFollowing: '保持各站网页当前选择',
    composerNextMode: '回答档位：{mode}（发送前会再次核对）',
    composerModeSite: '原站', composerModeFast: '快速', composerModeThink: '深思'
  },
  zhTW: {
    composerExpand: '展開輸入框', composerCollapse: '收合輸入框',
    tierSwitching: '正在將參與網站切為「{mode}」…',
    tierSwitchDone: '已將 {count} 個網站切為「{mode}」',
    tierSwitchPartial: '{count} 站已切為「{mode}」；未確認：{sites}',
    tierFollowing: '維持各網站網頁目前選擇',
    composerNextMode: '回答模式：{mode}（傳送前會再次核對）',
    composerModeSite: '原站', composerModeFast: '快速', composerModeThink: '深思'
  }
} as const;
