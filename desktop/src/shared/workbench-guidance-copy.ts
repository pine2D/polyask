const en = {
  guideInviteTitle: 'Try asking two sites', guideInviteShort: 'Try two sites',
  guideInviteDismiss: 'Dismiss the two-site invitation',
  guideChoosePrompt: 'You can start with two sites. Currently participating: {count}.',
  guideChooseAction: 'Choose participating sites',
  guideAskPrompt: 'Check these two sites, then ask your question.',
  guideCheckTwo: 'Check these two sites', guideFocusPrompt: 'Write a trial question',
  guideViewSite: 'Open {site}',
  guideWaitingCopies: 'Submitted to {count} sites; saved answer copies are not readable yet.',
  guideReadCopies: 'Read saved answer copies', guideCompareCopies: 'Choose saved copies to compare',
  guideIncompleteCopies: 'Some saved copies have unconfirmed completeness. You can read the saved text.',
  guideCompleteCopies: 'At least two complete saved copies are available for comparison.',
  guidePreferenceFailed: 'The guide preference could not be saved. The next launch may retain its previous state.',
  guideSavedCopiesTitle: 'Read and compare saved copies',
  guideSavedCopiesBody: 'Read saved answers in question history. With two saved copies, choose them to compare; check whether each copy is complete.'
} as const;
const zhCN: Record<keyof typeof en, string> = {
  guideInviteTitle: '先用两站试问', guideInviteShort: '两站试问',
  guideInviteDismiss: '关闭两站试问提示',
  guideChoosePrompt: '可以先选两站试问，当前参与 {count} 站。', guideChooseAction: '选择参与站点',
  guideAskPrompt: '先查看这两站，再写下你的问题。',
  guideCheckTwo: '检查这两站', guideFocusPrompt: '写下试问问题', guideViewSite: '查看 {site}',
  guideWaitingCopies: '已提交至 {count} 站，保存的回答副本暂时还不能阅读。',
  guideReadCopies: '阅读保存的回答', guideCompareCopies: '选择保存副本进行比较',
  guideIncompleteCopies: '部分副本的完整性尚未确认，可以先阅读已保存的文字。',
  guideCompleteCopies: '已有至少两份完整的保存副本，可选择后比较。',
  guidePreferenceFailed: '未能保存引导偏好，下次打开可能仍沿用原状态。',
  guideSavedCopiesTitle: '阅读并比较保存副本',
  guideSavedCopiesBody: '先在提问历史阅读保存的回答。有两份副本后可选择比较，并留意每份副本是否完整。'
};
const zhTW: Record<keyof typeof en, string> = {
  guideInviteTitle: '先用兩站試問', guideInviteShort: '兩站試問',
  guideInviteDismiss: '關閉兩站試問提示',
  guideChoosePrompt: '可以先選兩站試問，目前參與 {count} 站。', guideChooseAction: '選擇參與站點',
  guideAskPrompt: '先查看這兩站，再寫下你的問題。',
  guideCheckTwo: '檢查這兩站', guideFocusPrompt: '寫下試問問題', guideViewSite: '查看 {site}',
  guideWaitingCopies: '已提交至 {count} 站，儲存的回答副本暫時還不能閱讀。',
  guideReadCopies: '閱讀儲存的回答', guideCompareCopies: '選擇儲存副本進行比較',
  guideIncompleteCopies: '部分副本的完整性尚未確認，可以先閱讀已儲存的文字。',
  guideCompleteCopies: '已有至少兩份完整的儲存副本，可選擇後比較。',
  guidePreferenceFailed: '無法儲存引導偏好，下次開啟可能仍沿用原狀態。',
  guideSavedCopiesTitle: '閱讀並比較儲存副本',
  guideSavedCopiesBody: '先在提問歷史閱讀儲存的回答。有兩份副本後可選擇比較，並留意每份副本是否完整。'
};
export const WORKBENCH_GUIDANCE_COPY = { en, zhCN, zhTW };
