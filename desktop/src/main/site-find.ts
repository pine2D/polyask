import type { SiteKey } from '../shared/contracts';
import { SiteFindPositions, type PositionContents } from './site-find-positions';
import { initialSiteFindState, SITE_FIND_TIMEOUT_MS, type SiteFindRequest,
  type SiteFindResult, type SiteFindState } from '../shared/site-find';

interface FindContents extends PositionContents {
  readonly id: number;
  isDestroyed(): boolean;
  findInPage(text: string, options: { findNext: boolean; forward: boolean }): number;
  stopFindInPage(action: 'clearSelection'): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}
export interface SiteFindTarget { readonly site: SiteKey; readonly contents?: FindContents | null }
interface SiteFindHooks {
  readonly targets: () => readonly SiteFindTarget[];
  readonly focused: () => SiteKey;
  readonly allowed: () => boolean;
  readonly focus: (site: SiteKey) => void;
  readonly reserve: () => void;
  readonly restoreFocus: () => void;
  readonly publish: (state: SiteFindState) => void;
}
interface Binding {
  readonly site: SiteKey;
  readonly contents: FindContents;
  readonly listeners: Readonly<Record<string, (...args: any[]) => void>>;
  requestId: number | null;
  positions: SiteFindPositions;
  timer?: ReturnType<typeof setTimeout>;
}
type PendingMove = { direction: -1 | 1 } | { site: SiteKey };

/** Chromium 决定匹配与导航；位置摘要只读，不经 __AMS，不触碰网页输入或会话数据。 */
export class SiteFindController {
  private value = initialSiteFindState();
  private bindings = new Map<SiteKey, Binding>();
  private signature = '';
  private queued: PendingMove[] = [];
  constructor(private readonly hooks: SiteFindHooks) {}
  get state(): SiteFindState { return this.value; }

  open(): SiteFindState {
    if (!this.hooks.allowed()) return this.value;
    const first = !this.value.open;
    this.value = { ...this.value, open:true, session:this.value.session + (first ? 1 : 0), focusRequest:this.value.focusRequest + 1 };
    if (first) { this.restart(); this.hooks.reserve(); }
    return this.publish();
  }
  close(restoreFocus = true): SiteFindState {
    const wasOpen = this.value.open;
    this.clearBindings(); this.queued = []; this.signature = '';
    this.value = { ...this.value, open:false, activeSite:null, sites:[] };
    if (wasOpen) {
      this.hooks.reserve();
      if (restoreFocus && this.hooks.allowed()) this.hooks.restoreFocus();
      this.publish();
    }
    return this.value;
  }
  find(request: SiteFindRequest): SiteFindState {
    if (!this.value.open || !this.hooks.allowed()) return this.value;
    this.value = { ...this.value, ...request, activeSite:null };
    this.restart();
    return this.publish();
  }
  sync(): void {
    if (!this.value.open) return;
    if (!this.hooks.allowed()) { this.close(false); return; }
    if (this.targetSignature() !== this.signature) { this.restart(); this.publish(); }
    for (const result of this.value.sites) if (result.status === 'ready')
      this.bindings.get(result.site)?.positions.refresh(this.value.query, result.matches);
  }
  move(direction: -1 | 1): SiteFindState {
    if (!this.value.open || !this.hooks.allowed()) return this.value;
    if (this.value.sites.some(item => item.status === 'pending')) {
      this.queued.push({ direction }); return this.value;
    }
    const matches = this.value.sites.filter(item => item.status === 'ready' && item.matches > 0);
    if (!matches.length) return this.value;
    const index = matches.findIndex(item => item.site === this.value.activeSite);
    const current = matches[index];
    if (current && (direction > 0 ? current.active < current.matches : current.active > 1)) {
      this.request(this.bindings.get(current.site)!, false, direction);
    } else {
      const next = matches[index < 0 ? direction > 0 ? 0 : matches.length - 1
        : (index + direction + matches.length) % matches.length];
      this.activate(next.site);
      this.request(this.bindings.get(next.site)!, true, direction);
    }
    return this.publish();
  }
  select(site: SiteKey): SiteFindState {
    if (!this.value.open || !this.hooks.allowed()) return this.value;
    if (this.value.sites.some(item => item.status === 'pending')) { this.queued.push({ site }); return this.value; }
    const result = this.value.sites.find(item => item.site === site);
    if (result?.status === 'ready' && result.matches > 0) { this.activate(site); this.publish(); }
    return this.value;
  }
  dispose(): void { this.clearBindings(); this.queued = []; }

  handleInput(event: { preventDefault(): void }, input: { type: string; key: string; isComposing?: boolean }): void {
    if (this.value.open && this.hooks.allowed() && input.type === 'keyDown' && input.key === 'Escape' && !input.isComposing) {
      event.preventDefault(); this.close();
    }
  }

  private targets(): readonly SiteFindTarget[] {
    return this.hooks.targets().filter(target => this.value.scope === 'all' || target.site === this.hooks.focused());
  }
  private targetSignature(): string {
    return this.targets().map(({ site, contents }) => `${site}:${contents?.id ?? 0}`).join(',');
  }
  private restart(): void {
    this.clearBindings(); this.queued = [];
    this.signature = this.targetSignature();
    const targets = this.targets();
    this.value = { ...this.value, activeSite:null, sites:targets.map(({ site, contents }) => ({
      site, matches:0, active:0, status:this.value.query && contents && !contents.isDestroyed() ? 'pending' : 'ready'
    })) };
    for (const { site, contents } of targets) {
      if (!contents || contents.isDestroyed()) { if (this.value.query) this.update(site, { status:'unavailable' }); continue; }
      const binding = this.bind(site, contents);
      this.bindings.set(site, binding);
      if (this.value.query) this.request(binding, true, 1);
    }
  }
  private bind(site: SiteKey, contents: FindContents): Binding {
    const positions = new SiteFindPositions(contents, value => {
      if (this.bindings.get(site)?.contents !== contents || !this.value.open) return;
      const previous = this.value.sites.find(item => item.site === site)?.positions;
      if (previous?.length === value?.length && previous?.every((n, index) => n === value?.[index])) return;
      if (previous === undefined && value === undefined) return;
      this.update(site, { positions: value }); this.publish(true);
    });
    const binding: Binding = { site, contents, positions, requestId:null, listeners:{
      'found-in-page': (_event, result) => this.receive(binding, result),
      'did-start-navigation': details => {
        if (!this.value.query || !details?.isMainFrame || details.isSameDocument) return;
        this.invalidate(binding); this.publish();
      },
      'did-finish-load': () => { this.request(binding, true, 1); this.publish(); },
      'did-fail-load': (_event, _code, _description, _url, main) => {
        if (main) { this.request(binding, true, 1); this.publish(); }
      },
      'did-fail-provisional-load': (_event, _code, _description, _url, main) => {
        if (main) { this.request(binding, true, 1); this.publish(); }
      },
      'will-navigate': event => { if (event.defaultPrevented && event.isMainFrame) { this.request(binding, true, 1); this.publish(); } },
      'will-redirect': event => { if (event.defaultPrevented && event.isMainFrame) { this.request(binding, true, 1); this.publish(); } },
      'did-navigate-in-page': (_event, _url, main) => { if (main) { this.request(binding, true, 1); this.publish(); } },
      'render-process-gone': () => this.unavailable(binding),
      'destroyed': () => this.unavailable(binding),
      'before-input-event': (event, input) => this.handleInput(event, input)
    } };
    for (const [event, listener] of Object.entries(binding.listeners)) contents.on(event, listener);
    return binding;
  }
  private invalidate(binding: Binding): void {
    binding.positions.cancel();
    binding.requestId = null; clearTimeout(binding.timer);
    this.update(binding.site, { matches:0, active:0, status:'pending' });
    if (this.value.activeSite === binding.site) this.value = { ...this.value, activeSite:null };
    this.stop(binding);
    binding.timer = setTimeout(() => this.unavailable(binding), SITE_FIND_TIMEOUT_MS);
  }
  private request(binding: Binding, initial: boolean, direction: -1 | 1): void {
    if (this.bindings.get(binding.site) !== binding || !this.value.open || !this.value.query) return;
    binding.requestId = null; clearTimeout(binding.timer);
    this.update(binding.site, { status:'pending' });
    if (initial) { binding.positions.cancel(); this.stop(binding); }
    binding.timer = setTimeout(() => this.unavailable(binding), SITE_FIND_TIMEOUT_MS);
    try {
      if (binding.contents.isDestroyed()) throw Error('site_find_unavailable');
      // Electron 44: true 开始新查找，false 沿当前查找移动；不能按名字猜反。
      binding.requestId = binding.contents.findInPage(this.value.query, { findNext:initial, forward:direction > 0 });
    } catch { this.unavailable(binding); }
  }
  private receive(binding: Binding, result: unknown): void {
    if (this.bindings.get(binding.site) !== binding || !this.value.open || !result || typeof result !== 'object') return;
    const r = result as Record<string, unknown>;
    if (binding.requestId === null || r.requestId !== binding.requestId || r.finalUpdate !== true) return;
    const matches = r.matches as number, active = r.activeMatchOrdinal as number;
    if (!Number.isSafeInteger(matches) || matches < 0 || !Number.isSafeInteger(active) || active < 0 || active > matches) {
      this.unavailable(binding); return;
    }
    clearTimeout(binding.timer);
    this.update(binding.site, { matches, active, status:'ready' });
    binding.positions.refresh(this.value.query, matches);
    if (this.value.activeSite === null && binding.site === this.hooks.focused() && matches > 0) {
      this.value = { ...this.value, activeSite:binding.site };
    }
    this.publish(); this.drain();
  }
  private unavailable(binding: Binding): void {
    if (this.bindings.get(binding.site) !== binding) return;
    binding.positions.cancel();
    clearTimeout(binding.timer); binding.requestId = null;
    this.stop(binding);
    this.update(binding.site, { matches:0, active:0, status:'unavailable' });
    if (this.value.activeSite === binding.site) this.value = { ...this.value, activeSite:null };
    this.publish(); this.drain();
  }
  private activate(site: SiteKey): void {
    this.value = { ...this.value, activeSite:site };
    this.hooks.focus(site);
  }
  private drain(): void {
    while (this.queued.length && !this.value.sites.some(item => item.status === 'pending')) {
      const queued = this.queued.shift()!;
      if ('site' in queued) this.select(queued.site); else this.move(queued.direction);
    }
  }
  private update(site: SiteKey, patch: Partial<SiteFindResult>): void {
    this.value = { ...this.value, sites:this.value.sites.map(item => item.site === site ? { ...item, ...patch } : item) };
  }
  private publish(positionsOnly = false): SiteFindState {
    this.value = { ...this.value, revision:this.value.revision + (positionsOnly ? 0 : 1),
      positionRevision:this.value.positionRevision + (positionsOnly ? 1 : 0) };
    this.hooks.publish(this.value); return this.value;
  }
  private stop(binding: Binding): void {
    try { if (!binding.contents.isDestroyed()) binding.contents.stopFindInPage('clearSelection'); } catch { /* destroyed during navigation */ }
  }
  private clearBindings(): void {
    for (const binding of this.bindings.values()) {
      binding.positions.dispose();
      binding.requestId = null; clearTimeout(binding.timer);
      for (const [event, listener] of Object.entries(binding.listeners)) binding.contents.off(event, listener);
      this.stop(binding);
    }
    this.bindings.clear();
  }
}
