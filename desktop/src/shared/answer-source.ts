// 编号取保存快照的原始位置，不能按已选/有正文的回答重新排序；不写入同步格式。
export function answerSourceId(index: number): string {
  return `[S${index + 1}]`;
}
