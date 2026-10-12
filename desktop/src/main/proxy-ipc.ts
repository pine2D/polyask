// desktop/src/main/proxy-ipc.ts
// 代理设置 IPC（spec §3.4、§4.5、§6.1）。写通道 set/follow/accept：重置中直接 proxy_busy → 取 OperationGate →
// 取代理写锁 → 应用、写 SQLite、写/清密码文件、重算发布整条管线都在锁内；本机重置只取写锁，只能排在它后面。
// 只产出结果码（返回值的 result 字段，不叫 code、不进 SITE_CODES），不产出用户可见文案；入参一律字段白名单。
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { SiteKey } from "../shared/contracts";
import type { OperationGate } from "../shared/operation-gate";
import {
  checkProxyInput, PROXY_HOST_MAX, PROXY_SCHEMES, proxyPasswordProblem, sameRoute, type ProxyPreference, type ProxyScheme
} from "../shared/proxy-preference";
import type {
  ProxyAcceptRequest, ProxyInvalidField, ProxyReloadResult, ProxyStateView, ProxyTestResult, ProxyWriteFailure, ProxyWriteResult
} from "../shared/proxy-state";
import type { ProxyAuth } from "./proxy-auth";
import { classifyProxyInputs, type ProxyPreferenceStore } from "./proxy-preference-store";
import type { ProxyRuntime } from "./proxy-runtime";
import { resolveProxyTarget, type PendingConfirm, type ProxyTargetResult } from "./proxy-target";

export const PROXY_IPC_CHANNELS = [
  "polyask:proxy-state", "polyask:proxy-set", "polyask:proxy-follow",
  "polyask:proxy-accept", "polyask:proxy-test", "polyask:proxy-reload-sites"
] as const;
export const PROXY_STATE_CHANGED = "polyask:proxy-state-changed";
type ProxyChannel = (typeof PROXY_IPC_CHANNELS)[number];

export type ProxyIpcListener = (event: IpcMainInvokeEvent, value?: unknown) => unknown;
/** ipcMain 的最小面：测试注入桩，生产缺省用 electron 的 ipcMain。 */
export interface ProxyIpcMain {
  handle(channel: string, listener: ProxyIpcListener): void;
  removeHandler(channel: string): void;
}

export type ProxyRuntimePort = Pick<ProxyRuntime,
  "applyNow" | "withWriteLock" | "wipeEpoch" | "state" | "onChange" | "recomputeFromStore" | "bindBusySource">;
/** 命名避开 proxy-runtime.ts 的 ProxyAuthPort（那是 runtime 消费 auth 的端口）。 */
export type ProxyIpcAuthPort = Pick<ProxyAuth,
  "wipeEpoch" | "persistCredential" | "securePersistence" | "authFailed" | "refreshSecretState" | "onChange">;
export type ProxyStorePort = Pick<ProxyPreferenceStore, "read" | "save" | "enableFollowing" | "disableFollowing" | "setAccepted">;
export interface ProxyProbePort {
  test(input: unknown, password?: string): Promise<ProxyTestResult>;
}

/** 主进程装配好的代理服务。probe / reloadSites 由 T15 提供；未传入时对应通道不注册。 */
export interface ProxyIpcServices {
  readonly runtime: ProxyRuntimePort;
  readonly auth: ProxyIpcAuthPort;
  readonly store: ProxyStorePort;
  readonly probe?: ProxyProbePort;
  readonly reloadSites?: () => Promise<{ readonly skipped: readonly SiteKey[] }>;
}

export interface ProxyIpcOptions extends ProxyIpcServices {
  readonly trusted: (event: IpcMainInvokeEvent) => boolean;
  readonly gate: Pick<OperationGate, "busy" | "onIdle" | "run">;
  readonly dataAdmin: { readonly isResetting: boolean };
  readonly send: (channel: string, payload: unknown) => void;
  readonly ipc?: ProxyIpcMain;
}

const DEVICE_ID_MAX = 128;
const TEST_INVALID: ProxyTestResult = { ok: false, result: "proxy_invalid" };

const ok = (): ProxyWriteResult => ({ ok: true });
const fail = (result: ProxyWriteFailure, field?: ProxyInvalidField): ProxyWriteResult =>
  field ? { ok: false, result, field } : { ok: false, result };

type SaveRequest =
  | { readonly ok: true; readonly value: ProxyPreference; readonly password: string | null | undefined }
  | { readonly ok: false; readonly field: ProxyInvalidField };

/** 只认普通对象，键必须都在白名单内；缺失的键交给各字段自己的校验。 */
function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).every(key => allowed.includes(key)) ? value as Record<string, unknown> : null;
}

/**
 * 密码只写不读：非空、≤PROXY_PASSWORD_MAX、无 C0/DEL/C1 控制字符（proxyPasswordProblem，与设置卡同一规则）；
 * 只有 custom 的 HTTP/HTTPS 身份能带密码（SOCKS 不支持认证）。proxyPasswordProblem 对非字符串返回 false，所以先判类型。
 */
function passwordFits(password: unknown, value: ProxyPreference): password is string {
  return typeof password === "string" && password.length > 0 && !proxyPasswordProblem(password) &&
    value.mode === "custom" && (value.scheme === "http" || value.scheme === "https");
}

/** §4.1 字符级校验 → 规范化 → 校验（checkProxyInput）；password：undefined 不改、null 清除、"" 拒收。 */
function parseSave(input: unknown): SaveRequest {
  const request = record(input, ["value", "password"]);
  if (!request) return { ok: false, field: "shape" };
  const checked = checkProxyInput(request.value);
  if (!checked.ok) return { ok: false, field: checked.field };
  const password = request.password;
  if (password === undefined || password === null) return { ok: true, value: checked.value, password };
  return passwordFits(password, checked.value) ? { ok: true, value: checked.value, password } : { ok: false, field: "password" };
}

function parseAccept(input: unknown): ProxyAcceptRequest | null {
  const request = record(input, ["scheme", "host", "port", "version"]);
  const version = record(request?.version, ["updatedAt", "deviceId"]);
  if (!request || !version) return null;
  const { scheme, host, port } = request;
  const { updatedAt, deviceId } = version;
  if (!PROXY_SCHEMES.includes(scheme as ProxyScheme) || typeof host !== "string" || !host || host.length > PROXY_HOST_MAX) return null;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt < 0) return null;
  if (typeof deviceId !== "string" || !deviceId || deviceId.length > DEVICE_ID_MAX) return null;
  return { scheme: scheme as ProxyScheme, host, port, version: { updatedAt, deviceId } };
}

function samePending(pending: PendingConfirm, request: ProxyAcceptRequest): boolean {
  return sameRoute(pending, request) && pending.version.updatedAt === request.version.updatedAt &&
    pending.version.deviceId === request.version.deviceId;
}

function isBusyError(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message;
  return message === "operation_busy" || message === "proxy_busy";
}

export function registerProxyIpc(options: ProxyIpcOptions): () => void {
  const { runtime, auth, store, gate } = options;
  const ipc = options.ipc ?? ipcMain;
  let disposed = false;
  const handle = (channel: ProxyChannel, action: (value: unknown) => unknown) => {
    ipc.handle(channel, (event, value) => {
      if (!options.trusted(event)) throw new Error("untrusted_sender");
      return action(value);
    });
  };

  // 忙碌来源（§3.4）：OperationGate（busy / onIdle / run，后台重算经 gate.run 执行）+ 本机重置标志。
  // T11 签名是 bindBusySource(gate, isResetting = () => false)，重置标志只从第二个参数读，必须单独传；
  // isResetting 是 DataAdminService 的 getter 属性，所以包成函数、每次现读。拿不到 gate 或正在重置时保留脏标记，onIdle 再试。
  runtime.bindBusySource(gate, () => options.dataAdmin.isResetting);

  /** proxy-state 与推送共用。逐字段拷贝即白名单：runtime 以后多出的内部字段不会漏到渲染层。 */
  const view = async (): Promise<ProxyStateView> => {
    const state = runtime.state();
    const encryption = await auth.securePersistence().catch(() => false);
    const pending = state.pendingConfirm;
    return {
      applied: state.applied, blocked: state.blocked, stored: state.stored, appliedResult: state.appliedResult,
      pending: state.pending, following: state.following, formValue: state.formValue,
      pendingConfirm: pending && { scheme: pending.scheme, host: pending.host, port: pending.port,
        version: { updatedAt: pending.version.updatedAt, deviceId: pending.version.deviceId } },
      secret: state.secret, encryption, linuxDesktopProxy: state.linuxDesktopProxy, authFailed: auth.authFailed()
    };
  };

  // 应用完成、挂起、冲刷、密码状态、待确认项的变化都经 onChange 到这里；同一轮里多次变化只推一次最新状态。
  let queued = false;
  const publish = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      view().then(state => { if (!disposed) options.send(PROXY_STATE_CHANGED, state); }, () => undefined);
    });
  };
  const offRuntime = runtime.onChange(publish);
  const offAuth = auth.onChange(publish);

  /** 先 gate、后写锁；本机重置不走 gate，只能在进 gate 之前看标志（与 shell-ipc 群发入口一致）。 */
  const exclusive = async (action: () => Promise<ProxyWriteResult>): Promise<ProxyWriteResult> => {
    if (options.dataAdmin.isResetting) return fail("proxy_busy");
    try { return await gate.run(() => runtime.withWriteLock(action)); }
    catch (error) {
      if (isBusyError(error)) return fail("proxy_busy");
      throw error;
    }
  };

  /** 锁内从 store 重算一次（幂等），让 following / formValue / pendingConfirm 跟上刚落盘的数据，并触发推送。 */
  const republish = async () => {
    try { await runtime.recomputeFromStore(); }
    catch { /* 已落盘的结果不因发布失败而改变；runtime 的状态与推送会反映真实线路 */ }
  };

  /** store 当前算得出的待确认项（只算不应用）。 */
  const storedPending = (): PendingConfirm | null => {
    const classified = classifyProxyInputs(store.read());
    if (classified.kind !== "resolve") return null;
    try { return resolveProxyTarget(classified.input).pendingConfirm; } catch { return null; }
  };

  // §3.4 proxy-set：先应用，后落盘。跟随时本机保存就是本机确认，所以目标恒为 value 本身。
  const save = async (input: unknown): Promise<ProxyWriteResult> => {
    const request = parseSave(input);
    if (!request.ok) return fail("proxy_invalid", request.field);
    const { value, password } = request;
    return exclusive(async () => {
      const epoch = runtime.wipeEpoch(), secretEpoch = auth.wipeEpoch();
      if (runtime.state().pendingConfirm || storedPending()) return fail("proxy_pending_confirm");
      const applied = await runtime.applyNow(value, password);
      if (!applied.ok) return fail(applied.result);
      if (runtime.wipeEpoch() !== epoch) return fail("proxy_busy");
      // 跟随：同一事务写 S（入 outbox）+ A；不跟随：写 override；following 损坏：写 override、following=false、删 A。
      store.save(value);
      let secretFailed = false;
      if (password !== undefined) {
        const persisted = await auth.persistCredential(value, password, secretEpoch);
        if (persisted === "aborted" || runtime.wipeEpoch() !== epoch) return fail("proxy_busy");
        secretFailed = persisted === "failed";
      }
      await republish();
      return secretFailed ? { ok: true, secret: "failed" } : ok();
    });
  };

  const enableFollowing = async (): Promise<ProxyWriteResult> => {
    const epoch = runtime.wipeEpoch();
    const classified = classifyProxyInputs(store.read());
    const state = runtime.state();
    // 阻断或 stored_invalid 时拒绝：先用 proxy-set 修正本机设置。阻断配置从不记为 applied。
    if (classified.kind === "blocked" || state.blocked || !state.applied) return fail("proxy_invalid");
    if (classified.input.following) return ok();
    let resolved: ProxyTargetResult;
    try {
      // 这一次的比较基准固定为打开那一刻的已应用配置，忽略可能残留的 A；不持久化。
      resolved = resolveProxyTarget({ ...classified.input, following: true, appliedAtFollowOn: state.applied });
    } catch { return fail("proxy_invalid"); }
    const applied = await runtime.applyNow(resolved.target);
    if (!applied.ok) return fail(applied.result);
    if (runtime.wipeEpoch() !== epoch) return fail("proxy_busy");
    store.enableFollowing(resolved.target, classified.input.shared === null);
    await republish();
    return ok();
  };

  const disableFollowing = async (): Promise<ProxyWriteResult> => {
    const inputs = store.read();
    if (inputs.following.kind === "absent" || (inputs.following.kind === "ok" && !inputs.following.value)) return ok();
    const state = runtime.state();
    if (inputs.following.kind === "invalid" || inputs.accepted.kind === "invalid" || state.blocked || !state.applied) {
      return fail("proxy_invalid");
    }
    // 本机覆盖值取 A（没有 A 时取已应用配置）；永远不把未确认的 S 复制进本地。
    store.disableFollowing(inputs.accepted.kind === "ok" ? inputs.accepted.value : state.applied);
    await republish();
    return ok();
  };

  // §4.5：入参 = 当前待确认项、store 里 S 的版本 = 待确认项的版本、S 的线路 = 入参，三条全满足才应用。
  const accept = async (input: unknown): Promise<ProxyWriteResult> => {
    const request = parseAccept(input);
    if (!request) return fail("proxy_invalid");
    return exclusive(async () => {
      const epoch = runtime.wipeEpoch();
      const pending = runtime.state().pendingConfirm;
      const shared = store.read().shared;
      const current = shared.kind === "ok" ? shared.value : null;
      if (!pending || !current || !samePending(pending, request) || current.value.mode !== "custom" ||
        current.updatedAt !== pending.version.updatedAt || current.deviceId !== pending.version.deviceId ||
        !sameRoute(current.value, request)) {
        // 横幅显示的已经不是 store 里的 S：重算一次刷新横幅。
        await republish();
        return fail("proxy_not_pending");
      }
      const applied = await runtime.applyNow(current.value);
      if (!applied.ok) return fail(applied.result);
      if (runtime.wipeEpoch() !== epoch) return fail("proxy_busy");
      store.setAccepted(current.value);
      await republish();
      return ok();
    });
  };

  handle("polyask:proxy-state", async input => {
    const state = await view();
    // 只有设置卡发 { secret: true }：先报当前状态，后台读一次（5s 超时），读完经 proxy-state-changed 推送。
    // unreadable 也交给 refreshSecretState：是否已满重试间隔由 proxy-auth 判断（用户解锁钥匙环后重开设置卡能再读）。
    // 不带标志（外壳顶层提示、诊断报告，每次启动都会调）一律只读状态：启动时不读密码（spec §3.3），首个 407 才读。
    const request = record(input, ["secret"]);
    const retry = state.secret === "unknown" || state.secret === "unreadable";
    if (request?.secret === true && retry) void auth.refreshSecretState().catch(() => undefined);
    return state;
  });
  handle("polyask:proxy-set", save);
  handle("polyask:proxy-follow", input => {
    const request = record(input, ["enabled"]);
    if (!request || typeof request.enabled !== "boolean") return fail("proxy_invalid");
    return exclusive(request.enabled ? enableFollowing : disableFollowing);
  });
  handle("polyask:proxy-accept", accept);

  const { probe, reloadSites } = options;
  if (probe) {
    handle("polyask:proxy-test", input => {
      // 测试不受 OperationGate 限制；并发（proxy_test_busy）与表单校验（proxy_invalid）由 probe 自己负责。
      const request = record(input, ["value", "password"]);
      const password = request?.password;
      if (!request || (password !== undefined && typeof password !== "string")) return TEST_INVALID;
      return probe.test(request.value, typeof password === "string" ? password : undefined);
    });
  }
  if (reloadSites) {
    handle("polyask:proxy-reload-sites", async (): Promise<ProxyReloadResult> => {
      if (options.dataAdmin.isResetting) return { ok: false, result: "proxy_busy" };
      try {
        // 先关闭站点连接再逐站 reload，会中断正在生成的回答，所以必须拿到 gate。
        const { skipped } = await gate.run(reloadSites);
        return { ok: true, skipped: [...skipped] };
      } catch (error) {
        if (isBusyError(error)) return { ok: false, result: "proxy_busy" };
        throw error;
      }
    });
  }

  // macOS 关窗后 activate 会重建窗口并重新注册：通道与订阅都要注销干净。
  return () => {
    disposed = true;
    offRuntime();
    offAuth();
    for (const channel of PROXY_IPC_CHANNELS) ipc.removeHandler(channel);
  };
}
