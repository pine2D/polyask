/** Shell mutations share one gate so a navigation cannot replace an in-flight send. */
export class OperationGate {
  private active = false;
  private readonly idleListeners = new Set<() => void>();

  /** 只读：有外壳变更操作在进行。代理后台重算据此推迟到空闲（§3.4）。 */
  get busy(): boolean { return this.active; }

  /** 每次 run 结束（成功或失败）后通知；被拒的 operation_busy 不算。返回取消订阅。 */
  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => { this.idleListeners.delete(listener); };
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error("operation_busy");
    this.active = true;
    try { return await action(); }
    finally {
      this.active = false;
      for (const listener of [...this.idleListeners]) {
        try { listener(); } catch { /* 监听方故障不得卡住 gate 或改变 run 的结果 */ }
      }
    }
  }
}
