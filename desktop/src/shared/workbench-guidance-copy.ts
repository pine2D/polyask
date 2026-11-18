const en = {
  guideSavedCopiesTitle: 'Read and compare saved copies',
  guideSavedCopiesBody: 'Read saved answers in question history. With two saved copies, choose them to compare; check whether each copy is complete.'
} as const;
const zhCN: Record<keyof typeof en, string> = {
  guideSavedCopiesTitle: '阅读并比较保存副本',
  guideSavedCopiesBody: '先在提问历史阅读保存的回答。有两份副本后可选择比较，并留意每份副本是否完整。'
};
const zhTW: Record<keyof typeof en, string> = {
  guideSavedCopiesTitle: '閱讀並比較儲存副本',
  guideSavedCopiesBody: '先在提問歷史閱讀儲存的回答。有兩份副本後可選擇比較，並留意每份副本是否完整。'
};
export const WORKBENCH_GUIDANCE_COPY = { en, zhCN, zhTW };
