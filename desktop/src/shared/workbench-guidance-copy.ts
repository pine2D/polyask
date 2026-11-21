const en = {
  guideSavedCopiesTitle: 'Read and compare answers',
  guideSavedCopiesBody: 'Open Question history to read saved answers, or pick two to compare (check whether each answer finished).'
} as const;
const zhCN: Record<keyof typeof en, string> = {
  guideSavedCopiesTitle: '阅读与对比回答',
  guideSavedCopiesBody: '在「提问历史」查看自动留存的回答；满两站即可并排对比，留意每篇是否已答完。'
};
const zhTW: Record<keyof typeof en, string> = {
  guideSavedCopiesTitle: '閱讀與對比回答',
  guideSavedCopiesBody: '在「提問歷史」查看自動留存的回答；滿兩站即可並排對比，留意每篇是否已答完。'
};
export const WORKBENCH_GUIDANCE_COPY = { en, zhCN, zhTW };
