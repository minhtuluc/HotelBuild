/**
 * Bộ điều khiển SCR-42 (HB-134): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * kênh/bộ lọc/phiên; quản lý vòng đời ý định gắn cờ (một `Idempotency-Key` + `If-Match` cho mỗi ý định,
 * gửi lại đúng khoá/thân/`If-Match`, chưa rõ kết quả thì chặn lệnh khác — api.md §1.6).
 */
import { isApiError } from '@pinehill/api-client';
import type { ChannelSummary, OtaBooking } from '@pinehill/contracts';
import {
  canFlag,
  classify,
  emptyFilter,
  evidenceOf,
  filterIssues,
  flagIssues,
  flagRequest,
  keyExpired,
  sameIntent,
  tagOf,
  type Evidence,
  type Failure,
  type Filter,
  type FlagDraft,
  type Intent,
} from './model';
import type { Actor, OtaPorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface Rows {
  rows: readonly OtaBooking[];
  total: number;
  nextCursor: string | null;
}

export interface ControllerState {
  phase: Phase;
  channels: readonly ChannelSummary[];
  channelId: string | null;
  filter: Filter;
  list: Rows | null;
  actor: Actor | null;
  command: Command;
  pending: boolean;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: OtaPorts;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  channels: [],
  channelId: null,
  filter: emptyFilter,
  list: null,
  actor: null,
  command: { kind: 'idle' },
  pending: false,
  evidence: null,
};

export class OtaController {
  state: ControllerState = INITIAL_STATE;
  private channelId: string | null = null;
  private filter: Filter = emptyFilter;
  private pending: Intent | undefined;
  private reads = new AbortController();
  private readEpoch = 0;
  private writes = new AbortController();
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
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

  /** 401/403: dừng lệnh và request, xoá dữ liệu, ý định và bằng chứng của phạm vi cũ. */
  private deny(phase: 'forbidden' | 'expired'): void {
    this.stop();
    this.writes = new AbortController();
    this.pending = undefined;
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
    this.set({ channelId, list: null, command: { kind: 'idle' } });
    await this.load();
  }

  /** Bộ lọc sai hình dạng không gửi request; hợp lệ thì xoá danh sách cũ rồi đọc lại từ đầu. */
  async applyFilter(filter: Filter): Promise<void> {
    const issues = filterIssues(filter);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    this.filter = filter;
    this.set({ filter, list: null, command: { kind: 'idle' } });
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
      const list = await this.page(signal, undefined);
      if (stamp !== this.readEpoch) return;
      this.set({
        phase: 'ready',
        actor,
        channels,
        channelId: this.channelId,
        list,
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
    if (this.state.actor !== null && this.state.actor.userId !== actor.userId) {
      this.pending = undefined;
      this.set({ ...INITIAL_STATE, actor });
    }
    return actor;
  }

  private async page(signal: AbortSignal, cursor: string | undefined): Promise<Rows | null> {
    if (this.channelId === null) return null;
    const page = await this.options.ports.list(this.channelId, this.filter, cursor, signal);
    const before = cursor === undefined ? [] : (this.state.list?.rows ?? []);
    return {
      rows: [...before, ...page.data],
      total: page.meta.total,
      nextCursor: page.meta.hasMore ? (page.meta.nextCursor ?? null) : null,
    };
  }

  async loadMore(): Promise<void> {
    const cursor = this.state.list?.nextCursor;
    if (cursor === null || cursor === undefined) return;
    const { signal, stamp } = this.fresh();
    try {
      const list = await this.page(signal, cursor);
      if (stamp === this.readEpoch) this.set({ list, phase: 'ready', evidence: null });
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

  submitFlag(bookingId: string, draft: FlagDraft): Promise<void> {
    const role = this.state.actor?.role;
    const row = this.state.list?.rows.find((item) => item.id === bookingId);
    if (this.channelId === null || role === undefined || !canFlag(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    if (row === undefined) return Promise.resolve(this.blocked({ kind: 'conflict' }));
    const issues = flagIssues(draft);
    if (issues.length > 0) return Promise.resolve(this.blocked({ kind: 'validation', issues }));
    return this.start({
      channelId: this.channelId,
      bookingId,
      body: flagRequest(draft),
      ifMatch: tagOf(row),
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

  discardPending(): void {
    this.pending = undefined;
    this.set({ command: { kind: 'idle' } });
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    this.set({ command: { kind: 'sending' } });
    try {
      const booking = await this.options.ports.flag(intent, this.writes.signal);
      if (stamp !== this.scope) return;
      this.pending = undefined;
      this.set({ command: { kind: 'done' }, list: this.replaced(booking) });
      void this.load();
    } catch (error) {
      if (stamp !== this.scope) return;
      this.sendFailed(error);
    }
  }

  /** Thay đúng dòng bằng bản máy chủ vừa xác nhận; không tự sửa cờ cục bộ. */
  private replaced(booking: OtaBooking): Rows | null {
    const list = this.state.list;
    if (list === null) return null;
    return { ...list, rows: list.rows.map((row) => (row.id === booking.id ? booking : row)) };
  }

  private sendFailed(error: unknown): void {
    const failure = classify(error);
    if (failure.kind === 'expired' || failure.kind === 'forbidden') return this.deny(failure.kind);
    if (failure.kind === 'aborted') return;
    // Chỉ lỗi từ chối chắc chắn mới nhả ý định; còn lại giữ khoá để gửi lại hoặc đối soát.
    const settled = ['validation', 'conflict', 'keyReused', 'rejected'];
    if (settled.includes(failure.kind)) this.pending = undefined;
    this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
    if (failure.kind === 'conflict') void this.load();
  }
}
