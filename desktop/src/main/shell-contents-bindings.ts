interface ShellContents {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface ShellMirrorHooks {
  /** 按外壳当前缩放重排原生站点视图。 */
  readonly relayout: () => void;
  /** 把主进程里镜像渲染层的状态（表面/确认锁、抽屉、输入区展开、历史面板）复位到新渲染层的初值。 */
  readonly reset: () => void;
}

/**
 * 外壳新文档与原生视图布局的同步；缩放和重排由 page-zoom.ts 统一处理。
 * - did-navigate 只对主帧发：外壳每提交一份新文档（首载或任何途径的重载），渲染层状态全部回到初值，
 *   而主进程仍记着旧渲染层报来的 surface / 抽屉 / 输入区 / 历史面板——确认框期间重载会让确认锁永远不解除，
 *   全部菜单快捷键失效；停在设置页时重载则站点视图一直摘着。首载时复位是空操作。
 */
export function bindShellContents(contents: ShellContents, hooks: ShellMirrorHooks): void {
  contents.on("did-navigate", () => hooks.reset());
}
