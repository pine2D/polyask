/** Shell mutations share one gate so a navigation cannot replace an in-flight send. */
export class OperationGate {
  private active = false;
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error("operation_busy");
    this.active = true;
    try { return await action(); }
    finally { this.active = false; }
  }
}
