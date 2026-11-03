export const COMPOSER_COPY = {
  en: {
    composerExpand: 'Expand prompt', composerCollapse: 'Collapse prompt',
    tierSwitching: 'Switching participating sites to {mode}…',
    tierSwitchDone: '{mode} confirmed for {count} participating sites. The mode will be checked again before sending.',
    tierSwitchPartial: '{mode} confirmed for {count} sites; not confirmed: {sites}. The mode will be checked again before sending.',
    tierFollowing: 'Keeping each site’s current mode.',
    composerNextMode: 'Response mode: {mode}. Fast and Think apply to participating sites now and are checked again before sending.',
    composerModeSite: 'Site', composerModeFast: 'Fast', composerModeThink: 'Think'
  },
  zhCN: {
    composerExpand: '展开输入框', composerCollapse: '收起输入框',
    tierSwitching: '正在将参与提问的站点切换为{mode}…',
    tierSwitchDone: '已确认 {count} 个参与站点切换为{mode}，发送前仍会再次检查。',
    tierSwitchPartial: '已确认 {count} 个站点切换为{mode}；未确认：{sites}。发送前仍会再次检查。',
    tierFollowing: '保持各站点当前的回答档位。',
    composerNextMode: '回答档位：{mode}。快速和思考会立即应用到参与站点，发送前再次检查。',
    composerModeSite: '原站', composerModeFast: '快速', composerModeThink: '深思'
  },
  zhTW: {
    composerExpand: '展開輸入框', composerCollapse: '收起輸入框',
    tierSwitching: '正在將參與提問的網站切換為{mode}…',
    tierSwitchDone: '已確認 {count} 個參與網站切換為{mode}，傳送前仍會再次檢查。',
    tierSwitchPartial: '已確認 {count} 個網站切換為{mode}；未確認：{sites}。傳送前仍會再次檢查。',
    tierFollowing: '保留各網站目前的回答模式。',
    composerNextMode: '回答模式：{mode}。快速和思考會立即套用至參與網站，傳送前再次檢查。',
    composerModeSite: '原站', composerModeFast: '快速', composerModeThink: '深思'
  }
} as const;
