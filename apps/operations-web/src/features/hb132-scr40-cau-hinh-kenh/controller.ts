/**
 * Bộ điều khiển SCR-40 (HB-132): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * phạm vi/phiên, và quản lý vòng đời ý định ghi: một `Idempotency-Key` cho mỗi ý định, gửi lại đúng
 * khoá/thân/`If-Match`, chưa rõ kết quả thì chặn lệnh khác (api.md §1.6).
 */
import { isApiError } from '@pinehill/api-client';
import type { SalesClosureView, ChannelMapping } from '@pinehill/contracts';
import {
  canClose,
  canMap,
  classify,
  closureIssues,
  closureRequest,
  evidenceOf,
  keyExpired,
  mappingIssues,
  mappingRequest,
  sameIntent,
  type ClosureDraft,
  type Evidence,
  type Failure,
  type Intent,
  type MappingDraft,
} from './model';
import type { Actor, ConfigData, ConfigPorts, Selection } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface ConfirmedMapping {
  mapping: ChannelMapping;
  tag: string;
}

export interface ControllerState {
  phase: Phase;
  data: ConfigData | null;
  actor: Actor | null;
  command: Command;
  /** Còn một ý định chưa rõ kết quả: chỉ được gửi lại đúng nó hoặc bỏ có chủ đích. */
  pending: boolean;
  confirmed: Record<string, ConfirmedMapping>;
  closure: SalesClosureView | null;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: ConfigPorts;
  selection: Selection;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  data: null,
  actor: null,
  command: { kind: 'idle' },
  pending: false,
  confirmed: {},
  closure: null,
  evidence: null,
};

export const mappingKey = (channelId: string, roomTypeId: string): string =>
  `${channelId}:${roomTypeId}`;

export class ConfigController {
  state: ControllerState = INITIAL_STATE;
  private selection: Selection;
  private pending: Intent | undefined;
  /** Đọc có thể bị làm mới/đổi phạm vi huỷ; lệnh ghi chỉ bị huỷ khi mất phiên hoặc đóng màn hình. */
  private reads = new AbortController();
  private readEpoch = 0;
  private writes = new AbortController();
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
    this.selection = options.selection;
    this.newKey = options.newKey ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
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

  dispose(): void {
    this.alive = false;
    this.readEpoch += 1;
    this.scope += 1;
    this.reads.abort();
    this.writes.abort();
    this.listeners.clear();
  }

  /** 401/403: dừng hành động và xoá dữ liệu, ý định và bằng chứng của phạm vi cũ. */
  private deny(phase: 'forbidden' | 'expired'): void {
    this.readEpoch += 1;
    this.scope += 1;
    this.reads.abort();
    this.writes.abort();
    this.writes = new AbortController();
    this.pending = undefined;
    this.set({ ...INITIAL_STATE, phase });
  }

  private fresh(): { signal: AbortSignal; stamp: number } {
    this.reads.abort();
    this.reads = new AbortController();
    this.readEpoch += 1;
    return { signal: this.reads.signal, stamp: this.readEpoch };
  }

  /** Phiên hết hiệu lực (refresh thất bại): xoá dữ liệu và ý định của phiên cũ. */
  expire(): void {
    this.deny('expired');
  }

  /** Đổi cơ sở/kênh/loại phòng/khoảng ngày: huỷ request cũ, xoá dữ liệu cũ rồi đọc lại. */
  async select(next: Partial<Selection>): Promise<void> {
    const propertyChanged =
      next.propertyId !== undefined && next.propertyId !== this.selection.propertyId;
    this.selection = { ...this.selection, ...next };
    if (propertyChanged || next.channelId !== undefined || next.roomTypeId !== undefined)
      this.set({ data: null, confirmed: {}, closure: null, command: { kind: 'idle' } });
    await this.load();
  }

  async load(): Promise<void> {
    const { signal, stamp } = this.fresh();
    const refreshing = this.state.data !== null;
    this.set({ phase: refreshing ? 'refreshing' : 'loading' });
    try {
      const actor = await this.options.ports.actor(signal);
      if (stamp !== this.readEpoch) return;
      if (this.state.actor !== null && this.state.actor.userId !== actor.userId) {
        this.pending = undefined;
        this.set({ ...INITIAL_STATE, actor });
      } else this.set({ actor });
      const data = await this.options.ports.load(this.selection, signal);
      if (stamp !== this.readEpoch) return;
      this.selection = data.selection;
      this.set({ phase: 'ready', data, evidence: null });
    } catch (error) {
      if (stamp !== this.readEpoch) return;
      this.loadFailed(error);
    }
  }

  /** Lỗi đọc không bao giờ thành danh sách rỗng: giữ dữ liệu cũ và hiện băng lỗi. */
  private loadFailed(error: unknown): void {
    const failure = classify(error);
    if (failure.kind === 'expired') return this.deny('expired');
    if (failure.kind === 'forbidden') return this.deny('forbidden');
    const offline = isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
    this.set({ phase: offline ? 'offline' : 'error', evidence: evidenceOf(error) });
  }

  private fail(failure: Failure, error: unknown): void {
    this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
  }

  private blocked(failure: Failure): void {
    this.set({ command: { kind: 'failed', failure, evidence: {} } });
  }

  submitMapping(draft: MappingDraft): Promise<void> {
    const channelId = this.selection.channelId;
    const role = this.state.actor?.role;
    if (channelId === null || role === undefined || !canMap(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    const issues = mappingIssues(draft);
    if (issues.length > 0) return Promise.resolve(this.blocked({ kind: 'validation', issues }));
    const tag = this.state.confirmed[mappingKey(channelId, draft.roomTypeId)]?.tag;
    return this.start({
      kind: 'mapping',
      channelId,
      body: mappingRequest(draft),
      ifMatch: tag,
      key: this.newKey(),
      createdAt: this.now(),
    });
  }

  submitClosure(draft: ClosureDraft): Promise<void> {
    const channelId = this.selection.channelId;
    const role = this.state.actor?.role;
    if (channelId === null || role === undefined || !canClose(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    const issues = closureIssues(draft);
    if (issues.length > 0) return Promise.resolve(this.blocked({ kind: 'validation', issues }));
    return this.start({
      kind: 'closure',
      channelId,
      body: closureRequest(draft),
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

  /** Gửi lại đúng ý định cũ (cùng khoá, thân, `If-Match`); quá 24 giờ thì không gửi lại mù. */
  retry(): Promise<void> {
    const intent = this.pending;
    if (intent === undefined || this.state.command.kind === 'sending') return Promise.resolve();
    if (keyExpired(intent, this.now())) return Promise.resolve(this.blocked({ kind: 'ttl' }));
    return this.send(intent);
  }

  /** Bỏ có chủ đích ý định chưa rõ (sau khi người dùng đã đối soát) để được tạo ý định mới. */
  discardPending(): void {
    this.pending = undefined;
    this.set({ command: { kind: 'idle' } });
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    const signal = this.writes.signal;
    this.set({ command: { kind: 'sending' } });
    try {
      if (intent.kind === 'mapping') {
        const { view, etag } = await this.options.ports.putMapping(intent, signal);
        if (stamp !== this.scope) return;
        const key = mappingKey(view.channelId, view.mapping.roomTypeId);
        this.pending = undefined;
        this.set({
          command: { kind: 'done' },
          confirmed: {
            ...this.state.confirmed,
            [key]: { mapping: view.mapping, tag: etag ?? `"${view.version}"` },
          },
        });
      } else {
        const closure = await this.options.ports.closeSales(intent, signal);
        if (stamp !== this.scope) return;
        this.pending = undefined;
        this.set({ command: { kind: 'done' }, closure });
      }
      void this.load();
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
    const settled = ['validation', 'overLimit', 'conflict', 'keyReused', 'rejected'];
    if (settled.includes(failure.kind)) this.pending = undefined;
    this.fail(failure, error);
    if (failure.kind === 'conflict') void this.load();
  }
}
