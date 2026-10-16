import { historyPanelWidth } from './question-layout';

/** 工具栏用完整逻辑宽度；历史侧栏只占用站点内容区，不能改变工具栏高度。 */
export function workspaceViewport(contentSize: readonly [number, number], zoomFactor: number, historyPanelOpen: boolean) {
  const zoom = Math.max(0.25, zoomFactor);
  const shellWidth = Math.floor(contentSize[0] / zoom);
  return { zoom, shellWidth, width: shellWidth - historyPanelWidth(shellWidth, historyPanelOpen),
    height: Math.floor(contentSize[1] / zoom) };
}
