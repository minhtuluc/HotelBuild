/**
 * Bộ điều khiển SCR-43 (HB-135): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * bộ lọc/phiên; quản lý vòng đời ý định đóng ca (một `Idempotency-Key` + `If-Match` cho mỗi ý định,
 * gửi lại đúng khoá/thân/`If-Match`, chưa rõ kết quả thì chặn lệnh khác — api.md §1.6).
 */
import { isApiError } from '@pinehill/api-client';
import type {
  OverbookingCaseSummary,
  OverbookingScanMetadata,
  PropertySummary,
  RoomTypeSummary,
} from '@pinehill/contracts';
import {
  canResolve,
  classify,
  emptyFilter,
  evidenceOf,
  filterIssues,
  resolveIssues,
  resolveRequest,
  keyExpired,
  sameIntent,
  tagOf,
  type Evidence,
  type Failure,
  type Filter,
  type Intent,
} from './model';
import type { Actor, CasePorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface Rows {
  rows: readonly OverbookingCaseSummary[];
  total: number;
  nextCursor: string | null;
  overdueCount: number;
  scan: OverbookingScanMetadata;
}

export interface ControllerState {
  phase: Phase;
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  filter: Filter;
  list: Rows | null;
  actor: Actor | null;
  command: Command;
  pending: boolean;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: CasePorts;
  filter?: Filter;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  properties: [],
  roomTypes: [],
  filter: emptyFilter,
  list: null,
  actor: null,
  command: { kind: 'idle' },
  pending: false,
  evidence: null,
};

export class CaseController {
  state: ControllerState = INITIAL_STATE;
  private filter: Filter;
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
    this.filter = options.filter ?? emptyFilter;
    this.state = { ...INITIAL_STATE, filter: this.filter };
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
    this.set({ ...INITIAL_STATE, filter: this.filter, phase });
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
    this.set({ phase: this.state.list !== null ? 'refreshing' : 'loading' });
    try {
      const actor = await this.identify(signal);
      const catalogue = await this.options.ports.catalogue(signal);
      if (stamp !== this.readEpoch) return;
      const list = await this.page(signal, undefined);
      if (stamp !== this.readEpoch) return;
      this.set({ phase: 'ready', actor, ...catalogue, list, evidence: null });
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
      this.set({ ...INITIAL_STATE, filter: this.filter, actor });
    }
    return actor;
  }

  private async page(signal: AbortSignal, cursor: string | undefined): Promise<Rows> {
    const page = await this.options.ports.list(this.filter, cursor, signal);
    const before = cursor === undefined ? [] : (this.state.list?.rows ?? []);
    return {
      rows: [...before, ...page.data],
      total: page.meta.total ?? page.data.length,
      nextCursor: page.meta.hasMore ? page.meta.nextCursor : null,
      overdueCount: page.meta.overdueCount,
      scan: page.meta.scan,
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

  submitResolve(caseId: string, note: string): Promise<void> {
    const role = this.state.actor?.role;
    const row = this.state.list?.rows.find((item) => item.id === caseId);
    if (role === undefined || !canResolve(role))
      return Promise.resolve(this.blocked({ kind: 'forbidden' }));
    if (row === undefined) return Promise.resolve(this.blocked({ kind: 'conflict' }));
    const issues = resolveIssues(note);
    if (issues.length > 0) return Promise.resolve(this.blocked({ kind: 'validation', issues }));
    return this.start({
      caseId,
      body: resolveRequest(note),
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
      await this.options.ports.resolve(intent);
      if (stamp !== this.scope) return;
      this.pending = undefined;
      this.set({ command: { kind: 'done' } });
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
    const settled = ['validation', 'conflict', 'keyReused', 'rejected', 'deadlinePassed'];
    if (settled.includes(failure.kind)) this.pending = undefined;
    this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
    if (failure.kind === 'conflict') void this.load();
  }
}
