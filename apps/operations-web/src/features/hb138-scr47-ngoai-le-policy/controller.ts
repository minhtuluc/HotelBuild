/**
 * Bộ điều khiển SCR-47 (HB-138): không React, kiểm bằng vitest. Chỉ MANAGER/OWNER được tải hồ sơ; giữ dữ liệu
 * cũ khi làm mới, xoá khi đổi phiên/người dùng; vòng đời ba loại ý định ghi (lập/duyệt/từ chối ngoại lệ): một
 * khoá cho mỗi ý định, gửi lại đúng khoá/thân, chưa rõ kết quả thì chặn lệnh khác và đối soát bằng cách đọc
 * lại hồ sơ. Duyệt không đồng nghĩa đã chi: nhãn chỉ đổi theo bản đọc lại từ máy chủ. PIN chỉ trong RAM.
 */
import { isApiError } from '@pinehill/api-client';
import type { PropertySummary, RefundRequest } from '@pinehill/contracts';
import {
  SETTLED,
  approveRequest,
  canAct,
  canDecide,
  classify,
  createIssues,
  createRequest,
  emptyFilter,
  evidenceOf,
  filterIssues,
  keyExpired,
  pinIssues,
  rejectIssues,
  rejectRequest,
  sameIntent,
  type CreateDraft,
  type Evidence,
  type Failure,
  type Filter,
  type Intent,
} from './model';
import type { Actor, ExceptionPorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface Rows {
  rows: readonly RefundRequest[];
  total: number;
  nextCursor: string | null;
}

export interface ControllerState {
  phase: Phase;
  actor: Actor | null;
  properties: readonly PropertySummary[];
  filter: Filter;
  list: Rows | null;
  command: Command;
  pending: boolean;
  /** Trạng thái hồ sơ trên máy chủ sau khi đối soát một ý định chưa rõ. */
  intentState: string | null;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: ExceptionPorts;
  /** Bộ lọc mở màn (vd. cơ sở đang làm việc — TD-44). */
  filter?: Filter;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  actor: null,
  properties: [],
  filter: emptyFilter,
  list: null,
  command: { kind: 'idle' },
  pending: false,
  intentState: null,
  evidence: null,
};

export class ExceptionController {
  state: ControllerState = INITIAL_STATE;
  private filter: Filter = emptyFilter;
  private pending: Intent | undefined;
  private reads = new AbortController();
  private readEpoch = 0;
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
    this.filter = options.filter ?? emptyFilter;
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
    this.options.ports.clearPin();
  }

  dispose(): void {
    this.alive = false;
    this.stop();
    this.listeners.clear();
  }

  /** 401/403: dừng, xoá hồ sơ, ý định và PIN của phạm vi cũ. */
  private deny(phase: 'forbidden' | 'expired'): void {
    this.stop();
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
    if (filterIssues(filter).length > 0)
      return this.blocked({ kind: 'validation', issues: filterIssues(filter) });
    this.filter = filter;
    this.set({ filter, list: null, command: { kind: 'idle' } });
    await this.load();
  }

  async load(): Promise<void> {
    const { signal, stamp } = this.fresh();
    this.set({ phase: this.state.list !== null ? 'refreshing' : 'loading' });
    try {
      const actor = await this.identify(signal);
      // Vai không có quyền không được tải hồ sơ: không gửi request đọc nào (fail closed).
      if (!canDecide(actor.role)) return this.deny('forbidden');
      const properties = await this.options.ports.properties(signal);
      const list = await this.page(signal, undefined);
      if (stamp !== this.readEpoch) return;
      this.set({ phase: 'ready', actor, properties, list, evidence: null });
    } catch (error) {
      if (stamp !== this.readEpoch) return;
      this.loadFailed(error);
    }
  }

  /** Đổi người dùng giữa chừng thì bỏ dữ liệu, ý định và PIN của người trước. */
  private async identify(signal: AbortSignal): Promise<Actor> {
    const actor = await this.options.ports.actor(signal);
    if (this.state.actor !== null && this.state.actor.userId !== actor.userId) {
      this.pending = undefined;
      this.options.ports.clearPin();
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

  /** Lỗi đọc không bao giờ thành "không có hồ sơ": giữ dữ liệu cũ và hiện băng lỗi. */
  private loadFailed(error: unknown): void {
    const failure = classify(error);
    if (failure.kind === 'expired' || failure.kind === 'forbidden') return this.deny(failure.kind);
    const offline = isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');
    this.set({ phase: offline ? 'offline' : 'error', evidence: evidenceOf(error) });
  }

  private blocked(failure: Failure): Promise<void> {
    this.set({ command: { kind: 'failed', failure, evidence: {} } });
    return Promise.resolve();
  }

  private intent(kind: Intent['kind'], target: string, body: unknown): Intent {
    return { kind, target, body, key: this.newKey(), createdAt: this.now() };
  }

  submitCreate(draft: CreateDraft): Promise<void> {
    const role = this.state.actor?.role;
    if (role === undefined || !canDecide(role)) return this.blocked({ kind: 'forbidden' });
    const issues = createIssues(draft);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    return this.start(this.intent('create', '', createRequest(draft)));
  }

  private target(id: string): RefundRequest | null {
    const { actor, list } = this.state;
    const row = list?.rows.find((item) => item.id === id);
    if (actor === null || row === undefined) return null;
    return canAct(actor.role, actor.userId, row) ? row : null;
  }

  async submitApprove(id: string, note: string, pin: string): Promise<void> {
    const row = this.target(id);
    if (row === null) return this.blocked({ kind: 'forbidden' });
    const issues = [
      ...pinIssues(pin),
      ...(note.trim().length > 500 ? [{ field: 'note', issue: 'TOO_LONG' }] : []),
    ];
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    await this.pinned(pin, row.bookingId, () =>
      this.intent('approve', id, approveRequest(row, note)),
    );
  }

  async submitReject(id: string, note: string, pin: string): Promise<void> {
    const row = this.target(id);
    if (row === null) return this.blocked({ kind: 'forbidden' });
    const issues = [...rejectIssues(note), ...pinIssues(pin)];
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    await this.pinned(pin, row.bookingId, () => this.intent('reject', id, rejectRequest(note)));
  }

  /** Đổi PIN lấy mã một lần (chỉ khi chưa có ý định treo), rồi mới tạo ý định; lỗi PIN không phải mất phiên. */
  private async pinned(pin: string, bookingId: string, build: () => Intent): Promise<void> {
    if (this.pending === undefined) {
      try {
        await this.options.ports.verifyPin(pin, bookingId);
      } catch (error) {
        const failure = classify(error);
        if (failure.kind === 'expired' || failure.kind === 'forbidden')
          return this.deny(failure.kind);
        this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
        return;
      }
    }
    await this.start(build());
  }

  /** Ý định mới chỉ được tạo khi không còn ý định chưa rõ; cùng nội dung thì dùng lại khoá cũ. */
  private start(intent: Intent): Promise<void> {
    if (this.state.command.kind === 'sending') return Promise.resolve();
    if (this.pending !== undefined) {
      if (!sameIntent(this.pending, intent)) return this.blocked({ kind: 'unknown' });
      return this.send(this.pending);
    }
    this.pending = intent;
    return this.send(intent);
  }

  /** Gửi lại đúng ý định cũ (cùng khoá, thân); quá 24 giờ thì không gửi lại mù. */
  retry(): Promise<void> {
    const intent = this.pending;
    if (intent === undefined || this.state.command.kind === 'sending') return Promise.resolve();
    if (keyExpired(intent, this.now())) return this.blocked({ kind: 'ttl' });
    return this.send(intent);
  }

  discardPending(): void {
    this.pending = undefined;
    this.options.ports.clearPin();
    this.set({ command: { kind: 'idle' }, intentState: null });
  }

  /**
   * Đối soát một ý định chưa rõ bằng cách đọc lại hồ sơ (hợp đồng hoàn tiền không có `writeIntent`):
   * duyệt/từ chối đã có hiệu lực khi hồ sơ không còn PENDING thì nhả ý định; lập mới thì chỉ tải lại.
   */
  async lookup(): Promise<void> {
    const intent = this.pending;
    await this.load();
    if (intent === undefined || intent.kind === 'create') return;
    const row = this.state.list?.rows.find((item) => item.id === intent.target);
    if (row === undefined) return;
    this.set({ intentState: row.status });
    if (row.status !== 'PENDING') {
      this.pending = undefined;
      this.options.ports.clearPin();
      this.set({ command: { kind: 'idle' } });
    }
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    this.set({ command: { kind: 'sending' }, intentState: null });
    try {
      await this.options.ports.send(intent);
      if (stamp !== this.scope) return;
      this.pending = undefined;
      this.options.ports.clearPin();
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
    if (SETTLED.includes(failure.kind)) {
      this.pending = undefined;
      this.options.ports.clearPin();
    }
    this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
    // Hồ sơ đã đổi (đã xử lý/xung đột): đọc lại để xác nhận, không tự gửi lại.
    if (failure.kind === 'conflict') void this.load();
  }
}
