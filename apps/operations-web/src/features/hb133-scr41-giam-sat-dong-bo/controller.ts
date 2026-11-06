/**
 * Bộ điều khiển SCR-41 (HB-133): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * kênh/phiên; quản lý vòng đời ý định ghi (một `Idempotency-Key` cho mỗi ý định, gửi lại đúng khoá/thân)
 * và vòng đời tác vụ 202 → `GET /operations/{id}` đến trạng thái kết thúc (api.md §1.6, §6).
 */
import { isApiError } from '@pinehill/api-client';
import type {
  ChannelSyncRequest,
  ChannelSummary,
  ChannelSyncStatusView,
  OperationRef,
  OperationStatusView,
  OutboxDelivery,
} from '@pinehill/contracts';
import {
  canSync,
  classify,
  evidenceOf,
  isTerminal,
  keyExpired,
  sameIntent,
  syncIssues,
  syncRequest,
  type Evidence,
  type Failure,
  type Intent,
  type SyncDraft,
} from './model';
import type { Actor, SyncPorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'failed'; failure: Failure; evidence: Evidence };

/** Tác vụ đang theo dõi; `lost` = không tra được kết quả (giữ ID để tra lại, không tạo lệnh mới). */
export interface Tracked {
  id: string;
  channelId: string;
  status: OperationStatusView['status'];
  errorCode?: string;
  errorMessage?: string;
  lost: boolean;
}

export interface Deliveries {
  rows: readonly OutboxDelivery[];
  total: number;
  nextCursor: string | null;
}

export type StatusFilter = OutboxDelivery['status'] | null;

export interface ControllerState {
  phase: Phase;
  channels: readonly ChannelSummary[];
  channelId: string | null;
  status: ChannelSyncStatusView | null;
  deliveries: Deliveries | null;
  filter: StatusFilter;
  actor: Actor | null;
  command: Command;
  pending: boolean;
  operation: Tracked | null;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: SyncPorts;
  newKey?: () => string;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  channels: [],
  channelId: null,
  status: null,
  deliveries: null,
  filter: null,
  actor: null,
  command: { kind: 'idle' },
  pending: false,
  operation: null,
  evidence: null,
};

const POLL_FIRST_MS = 1000;
const POLL_MAX_MS = 10_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export class SyncController {
  state: ControllerState = INITIAL_STATE;
  private channelId: string | null = null;
  private filter: StatusFilter = null;
  private pending: Intent | undefined;
  private lastSync: ChannelSyncRequest | undefined;
  private reads = new AbortController();
  private readEpoch = 0;
  private writes = new AbortController();
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: ControllerOptions) {
    this.newKey = options.newKey ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.wait = options.wait ?? sleep;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ControllerState => this.state;

  private set(patch: Partial<ControllerState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch, pending: this.pending !== undefined };
    for (const listener of this.listeners) listener();
  }

  private stop(): void {
    this.readEpoch += 1;
    this.scope += 1;
    this.reads.abort();
    this.writes.abort();
  }

  dispose(): void {
    this.alive = false;
    this.stop();
    this.listeners.clear();
  }

  /** 401/403: dừng poll và lệnh, xoá dữ liệu, ý định và tác vụ của phạm vi cũ. */
  private deny(phase: 'forbidden' | 'expired'): void {
    this.stop();
    this.writes = new AbortController();
    this.pending = undefined;
    this.lastSync = undefined;
    this.set({ ...INITIAL_STATE, phase });
  }

  expire(): void {
    this.deny('expired');
  }

  private fresh(): { signal: AbortSignal; stamp: number } {
    this.reads.abort();
    this.reads = new AbortController();
    this.readEpoch += 1;
    return { signal: this.reads.signal, stamp: this.readEpoch };
  }

  async select(channelId: string): Promise<void> {
    if (channelId === this.channelId) return;
    this.channelId = channelId;
    this.set({ channelId, status: null, deliveries: null, command: { kind: 'idle' } });
    await this.load();
  }

  async setFilter(filter: StatusFilter): Promise<void> {
    this.filter = filter;
    this.set({ filter, deliveries: null });
    await this.load();
  }

  async load(): Promise<void> {
    const { signal, stamp } = this.fresh();
    this.set({ phase: this.state.channels.length > 0 ? 'refreshing' : 'loading' });
    try {
      const actor = await this.identify(signal);
      const channels = await this.options.ports.channels(signal);
      if (stamp !== this.readEpoch) return;
      this.channelId =
        channels.find((row) => row.id === this.channelId)?.id ?? channels[0]?.id ?? null;
      const projection = await this.project(signal);
      if (stamp !== this.readEpoch) return;
      this.set({
        phase: 'ready',
        actor,
        channels,
        channelId: this.channelId,
        ...projection,
        evidence: null,
      });
    } catch (error) {
      if (stamp !== this.readEpoch) return;
      this.loadFailed(error);
    }
  }

  /** Đổi người dùng giữa chừng thì bỏ dữ liệu và ý định của người trước. */
  private async identify(signal: AbortSignal): Promise<Actor> {
    const actor = await this.options.ports.actor(signal);
    if (this.state.actor !== null && this.state.actor.userId !== actor.userId) this.reset(actor);
    return actor;
  }

  private reset(actor: Actor): void {
    this.pending = undefined;
    this.set({ ...INITIAL_STATE, actor });
  }

  private async project(
    signal: AbortSignal,
    cursor?: string,
  ): Promise<{ status: ChannelSyncStatusView | null; deliveries: Deliveries | null }> {
    const { ports } = this.options;
    if (this.channelId === null) return { status: null, deliveries: null };
    const query = {
      ...(cursor === undefined ? {} : { cursor }),
      ...(this.filter === null ? {} : { status: this.filter }),
    };
    const [status, page] = await Promise.all([
      ports.status(this.channelId, signal),
      ports.deliveries(this.channelId, query, signal),
    ]);
    const before = cursor === undefined ? [] : (this.state.deliveries?.rows ?? []);
    return {
      status,
      deliveries: {
        rows: [...before, ...page.data],
        total: page.meta.total,
        nextCursor: page.meta.hasMore ? (page.meta.nextCursor ?? null) : null,
      },
    };
  }

  async loadMore(): Promise<void> {
    const cursor = this.state.deliveries?.nextCursor;
    if (cursor === null || cursor === undefined || this.channelId === null) return;
    const { signal, stamp } = this.fresh();
    try {
      const projection = await this.project(signal, cursor);
      if (stamp === this.readEpoch) this.set({ ...projection, phase: 'ready', evidence: null });
    } catch (error) {
      if (stamp === this.readEpoch) this.loadFailed(error);
    }
  }

  /** Lỗi đọc không bao giờ thành danh sách rỗng: giữ dữ liệu cũ và hiện băng lỗi. */
  private loadFailed(error: unknown): void {
    const failure = classify(error);
    if (failure.kind === 'expired' || failure.kind === 'forbidden') return this.deny(failure.kind);
    const offline = isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
    this.set({ phase: offline ? 'offline' : 'error', evidence: evidenceOf(error) });
  }

  private blocked(failure: Failure): void {
    this.set({ command: { kind: 'failed', failure, evidence: {} } });
  }

  submitSync(draft: SyncDraft): Promise<void> {
    const role = this.state.actor?.role;
    if (this.channelId === null || role === undefined || !canSync(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    const issues = syncIssues(draft);
    if (issues.length > 0) return Promise.resolve(this.blocked({ kind: 'validation', issues }));
    return this.start({
      kind: 'sync',
      channelId: this.channelId,
      body: syncRequest(draft),
      key: this.newKey(),
      createdAt: this.now(),
    });
  }

  /** Sau khi tác vụ FAILED: ý định mới (khoá mới) với đúng phạm vi của lần đồng bộ trước. */
  retryFailedSync(): Promise<void> {
    const body = this.lastSync;
    const role = this.state.actor?.role;
    if (body === undefined || this.channelId === null || role === undefined || !canSync(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    return this.start({
      kind: 'sync',
      channelId: this.channelId,
      body,
      key: this.newKey(),
      createdAt: this.now(),
    });
  }

  submitRetry(deliveryId: string): Promise<void> {
    const role = this.state.actor?.role;
    if (this.channelId === null || role === undefined || !canSync(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    return this.start({
      kind: 'retry',
      channelId: this.channelId,
      deliveryId,
      key: this.newKey(),
      createdAt: this.now(),
    });
  }

  /** Ý định mới chỉ được tạo khi không còn ý định chưa rõ; cùng nội dung thì dùng lại khoá cũ. */
  private start(intent: Intent): Promise<void> {
    if (this.state.command.kind === 'sending') return Promise.resolve();
    if (this.pending !== undefined) {
      if (!sameIntent(this.pending, intent))
        return Promise.resolve(this.blocked({ kind: 'unknown' }));
      return this.send(this.pending);
    }
    this.pending = intent;
    return this.send(intent);
  }

  /** Gửi lại đúng ý định cũ; quá 24 giờ thì không gửi lại mù. */
  retry(): Promise<void> {
    const intent = this.pending;
    if (intent === undefined || this.state.command.kind === 'sending') return Promise.resolve();
    if (keyExpired(intent, this.now())) return Promise.resolve(this.blocked({ kind: 'ttl' }));
    return this.send(intent);
  }

  discardPending(): void {
    this.pending = undefined;
    this.set({ command: { kind: 'idle' } });
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    const signal = this.writes.signal;
    this.set({ command: { kind: 'sending' } });
    try {
      const ref =
        intent.kind === 'sync'
          ? await this.options.ports.sync(intent, signal)
          : await this.options.ports.retry(intent, signal);
      if (stamp !== this.scope) return;
      this.pending = undefined;
      if (intent.kind === 'sync') this.lastSync = intent.body;
      this.set({ command: { kind: 'idle' } });
      this.track(ref, intent.channelId, stamp);
    } catch (error) {
      if (stamp !== this.scope) return;
      this.sendFailed(error);
    }
  }

  private sendFailed(error: unknown): void {
    const failure = classify(error);
    if (failure.kind === 'expired' || failure.kind === 'forbidden') return this.deny(failure.kind);
    if (failure.kind === 'aborted') return;
    // Chỉ lỗi từ chối chắc chắn mới nhả ý định; còn lại giữ khoá để gửi lại hoặc đối soát.
    const settled = ['validation', 'syncFailed', 'conflict', 'keyReused', 'rejected'];
    if (settled.includes(failure.kind)) this.pending = undefined;
    this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
  }

  /** 202: ghi nhận tác vụ (chưa phải "đã đồng bộ") rồi poll đến trạng thái kết thúc. */
  private track(ref: OperationRef, channelId: string, stamp: number): void {
    this.set({ operation: { id: ref.operationId, channelId, status: ref.status, lost: false } });
    if (!isTerminal(ref.status)) void this.poll(ref.operationId, stamp);
    else void this.load();
  }

  /** Tra lại tác vụ đã biết ID (sau mất mạng); không bao giờ tạo lệnh đồng bộ mới. */
  async checkOperation(): Promise<void> {
    const tracked = this.state.operation;
    if (tracked === null || isTerminal(tracked.status)) return;
    this.set({ operation: { ...tracked, lost: false } });
    await this.poll(tracked.id, this.scope);
  }

  private async poll(id: string, stamp: number): Promise<void> {
    const signal = this.writes.signal;
    let delay = POLL_FIRST_MS;
    while (this.alive && stamp === this.scope) {
      await this.wait(delay, signal);
      if (stamp !== this.scope) return;
      if (await this.pollOnce(id, signal, stamp)) return;
      delay = Math.min(delay * 2, POLL_MAX_MS);
    }
  }

  /** `true` khi phải dừng poll (kết thúc, mất quyền, hoặc không tra được). */
  private async pollOnce(id: string, signal: AbortSignal, stamp: number): Promise<boolean> {
    try {
      const view = await this.options.ports.operation(id, signal);
      if (stamp !== this.scope || this.state.operation?.id !== id) return true;
      const tracked = this.state.operation;
      this.set({
        operation: {
          ...tracked,
          status: view.status,
          lost: false,
          ...(view.errorCode === undefined ? {} : { errorCode: view.errorCode }),
          ...(view.errorMessage === undefined ? {} : { errorMessage: view.errorMessage }),
        },
      });
      if (isTerminal(view.status)) void this.load();
      return isTerminal(view.status);
    } catch (error) {
      return this.pollFailed(error, id, stamp);
    }
  }

  private pollFailed(error: unknown, id: string, stamp: number): boolean {
    if (stamp !== this.scope) return true;
    const failure = classify(error);
    if (failure.kind === 'expired' || failure.kind === 'forbidden') this.deny(failure.kind);
    else if (failure.kind !== 'aborted' && this.state.operation?.id === id)
      this.set({
        operation: { ...this.state.operation, lost: true },
        evidence: evidenceOf(error),
      });
    return true;
  }
}
