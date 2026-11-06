/**
 * Bộ điều khiển SCR-44 (HB-136): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * phạm vi/phiên; vòng đời ý định ghi (lập phương án, lập/duyệt/thực hiện điều chuyển): một khoá cho mỗi ý
 * định, gửi lại đúng khoá/thân/`If-Match`, chưa rõ kết quả thì chặn lệnh khác và tra theo `writeIntent`.
 * PIN chỉ đi qua `verifyPin` (đổi lấy mã một lần trong RAM) và không bao giờ nằm trong state.
 */
import { isApiError } from '@pinehill/api-client';
import type {
  BookingRelocationOptions,
  OverbookingCaseDetail,
  RelocationPlan,
  RoomMoveView,
} from '@pinehill/contracts';
import {
  SETTLED,
  actionAllowed,
  approveIssues,
  approveRequest,
  canCreate,
  canPlan,
  classify,
  evidenceOf,
  keyExpired,
  moveIssues,
  moveRequest,
  pinIssues,
  planRequest,
  sameIntent,
  tagOf,
  type ApproveDraft,
  type Evidence,
  type Failure,
  type Intent,
  type MoveDraft,
  type Params,
} from './model';
import type { Actor, RelocationPorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface MoveState {
  view: RoomMoveView;
  tag: string;
}

export interface ControllerState {
  phase: Phase;
  actor: Actor | null;
  detail: OverbookingCaseDetail | null;
  caseTag: string | undefined;
  plan: RelocationPlan | null;
  options: BookingRelocationOptions | null;
  move: MoveState | null;
  command: Command;
  pending: boolean;
  /** Trạng thái ý định ghi do máy chủ báo khi tra theo khoá (AC12). */
  intentState: string | null;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: RelocationPorts;
  params: Params;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  actor: null,
  detail: null,
  caseTag: undefined,
  plan: null,
  options: null,
  move: null,
  command: { kind: 'idle' },
  pending: false,
  intentState: null,
  evidence: null,
};

export class RelocationController {
  state: ControllerState = INITIAL_STATE;
  private pending: Intent | undefined;
  private moveId: string;
  private reads = new AbortController();
  private readEpoch = 0;
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
    this.moveId = options.params.moveId;
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

  /** 401/403 (mất phiên/quyền): dừng, xoá dữ liệu, ý định và mã PIN của phạm vi cũ. */
  private deny(phase: 'forbidden' | 'expired'): void {
    this.stop();
    this.pending = undefined;
    this.moveId = '';
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

  async load(): Promise<void> {
    const { signal, stamp } = this.fresh();
    this.set({ phase: this.state.actor === null ? 'loading' : 'refreshing' });
    try {
      const actor = await this.identify(signal);
      const data = await this.read(actor);
      if (stamp !== this.readEpoch) return;
      this.set({ phase: 'ready', actor, ...data, evidence: null });
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
      this.set({ ...INITIAL_STATE, actor });
    }
    return actor;
  }

  /** Quản lý đọc ca đầy đủ; lễ tân chỉ đọc phương án của chính booking đang xử lý (không bảng xếp hạng). */
  private async read(actor: Actor): Promise<Partial<ControllerState>> {
    const { ports, params } = this.options;
    const out: Partial<ControllerState> = {};
    if (canPlan(actor.role)) {
      const { detail, etag } = await ports.caseDetail(params.caseId);
      out.detail = detail;
      out.caseTag = etag ?? tagOf(detail.version);
    } else if (params.bookingId !== '') {
      out.options = await ports.options(params.bookingId, params.caseId);
    }
    if (this.moveId !== '') {
      const { view, etag } = await ports.move(this.moveId);
      out.move = { view, tag: etag ?? tagOf(view.version) };
    }
    return out;
  }

  /** Lỗi đọc không bao giờ thành "không có gì": giữ dữ liệu cũ và hiện băng lỗi. */
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

  private newIntent<T extends Intent['kind']>(
    kind: T,
  ): { kind: T; key: string; createdAt: number } {
    return { kind, key: this.newKey(), createdAt: this.now() };
  }

  submitPlan(strategy: 'AUTO' | 'MANUAL'): Promise<void> {
    const { actor, detail, caseTag } = this.state;
    if (actor === null || !canPlan(actor.role) || detail === null || caseTag === undefined)
      return this.blocked({ kind: 'forbidden' });
    return this.start({
      ...this.newIntent('plan'),
      caseId: this.options.params.caseId,
      body: planRequest(strategy),
      ifMatch: caseTag,
    });
  }

  submitCreate(draft: MoveDraft): Promise<void> {
    const { actor, options } = this.state;
    const { params } = this.options;
    const option = options?.options[draft.optionIndex];
    if (actor === null || !canCreate(actor.role)) return this.blocked({ kind: 'forbidden' });
    if (option === undefined || params.bookingRoomId === '')
      return this.blocked({ kind: 'conflict' });
    const issues = moveIssues(draft, option);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    return this.start({
      ...this.newIntent('create'),
      bookingId: params.bookingId,
      body: moveRequest(params, option, draft),
    });
  }

  async submitApprove(draft: ApproveDraft, pin: string): Promise<void> {
    const { actor, move } = this.state;
    if (actor === null || move === null || !actionAllowed(actor.role, 'APPROVE', move.view))
      return this.blocked({ kind: 'forbidden' });
    const issues = [...approveIssues(draft), ...pinIssues(pin)];
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    if (!(await this.verify(pin, move.view.bookingId))) return;
    await this.start({
      ...this.newIntent('approve'),
      moveId: move.view.id,
      body: approveRequest(draft),
      ifMatch: move.tag,
    });
  }

  async submitExecute(pin: string): Promise<void> {
    const { actor, move } = this.state;
    if (actor === null || move === null || !actionAllowed(actor.role, 'EXECUTE', move.view))
      return this.blocked({ kind: 'forbidden' });
    const issues = pinIssues(pin);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    if (!(await this.verify(pin, move.view.bookingId))) return;
    await this.start({
      ...this.newIntent('execute'),
      moveId: move.view.id,
      ifMatch: move.tag,
    });
  }

  /** Đổi PIN lấy mã một lần; PIN không được lưu, lỗi PIN không phải mất phiên. */
  private async verify(pin: string, bookingId: string): Promise<boolean> {
    if (this.pending !== undefined) return true;
    try {
      await this.options.ports.verifyPin(pin, bookingId);
      return true;
    } catch (error) {
      const failure = classify(error);
      if (failure.kind === 'expired' || failure.kind === 'forbidden') this.deny(failure.kind);
      else this.set({ command: { kind: 'failed', failure, evidence: evidenceOf(error) } });
      return false;
    }
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

  /** Gửi lại đúng ý định cũ (cùng khoá, thân, `If-Match`); quá 24 giờ thì không gửi lại mù. */
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

  /** Tra kết quả theo khoá lệnh (`writeIntent`) trước khi gửi lại hay tạo lệnh mới (AC12). */
  async lookup(): Promise<void> {
    const intent = this.pending;
    if (intent === undefined) return this.load();
    const stamp = this.scope;
    try {
      const state = await this.readIntent(intent);
      if (stamp !== this.scope) return;
      this.set({ intentState: state ?? 'UNKNOWN' });
      if (state === 'SUCCEEDED' || state === 'FAILED') {
        this.pending = undefined;
        this.options.ports.clearPin();
        this.set({ command: { kind: 'idle' } });
        await this.load();
      }
    } catch (error) {
      if (stamp === this.scope) this.loadFailed(error);
    }
  }

  private async readIntent(intent: Intent): Promise<string | null> {
    const { ports, params } = this.options;
    if (intent.kind === 'create')
      return (
        (await ports.options(intent.bookingId, params.caseId, intent.key)).writeIntent?.state ??
        null
      );
    if (intent.kind === 'plan') return null;
    return (await ports.move(intent.moveId, intent.key)).view.writeIntent?.state ?? null;
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    this.set({ command: { kind: 'sending' }, intentState: null });
    try {
      const patch = await this.dispatch(intent);
      if (stamp !== this.scope) return;
      this.pending = undefined;
      this.options.ports.clearPin();
      this.set({ command: { kind: 'done' }, ...patch });
      void this.load();
    } catch (error) {
      if (stamp !== this.scope) return;
      this.sendFailed(error);
    }
  }

  /** Mọi kết quả hiển thị đến từ phản hồi máy chủ; điều chuyển được đọc lại để lấy `allowedActions` và ETag. */
  private async dispatch(intent: Intent): Promise<Partial<ControllerState>> {
    const { ports } = this.options;
    if (intent.kind === 'plan') return { plan: await ports.plan(intent) };
    const move =
      intent.kind === 'create'
        ? await ports.create(intent)
        : intent.kind === 'approve'
          ? await ports.approve(intent)
          : await ports.execute(intent);
    this.moveId = move.id;
    const { view, etag } = await ports.move(move.id);
    return { move: { view, tag: etag ?? tagOf(view.version) } };
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
    // Phòng bị lấy/đồng ý bị rút/phiên bản đổi: đọc lại phương án, giữ nguồn và ca mở, không thử bậc sau.
    if (['conflict', 'roomTaken', 'noConsent'].includes(failure.kind)) void this.load();
  }
}
