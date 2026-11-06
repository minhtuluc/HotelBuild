/**
 * Bộ điều khiển SCR-45/46 (HB-137): không React, kiểm bằng vitest. Giữ dữ liệu cũ khi làm mới, xoá khi đổi
 * phiên/người dùng; vòng đời bảy loại ý định ghi (lập/đồng thuận/duyệt/thực thi ghép, duyệt/thực thi
 * walk-out, chi bồi thường): một khoá cho mỗi ý định, gửi lại đúng khoá/thân/`If-Match`, chưa rõ kết quả thì
 * chặn lệnh khác và tra theo `writeIntent`. PIN chỉ đi qua `verifyPin` (mã một lần trong RAM).
 */
import { isApiError } from '@pinehill/api-client';
import type { CompensationPaymentsView, RoomMergeView, RoomMoveView } from '@pinehill/contracts';
import {
  SETTLED,
  approveIssues,
  can,
  canPayCompensation,
  classify,
  consentIssues,
  consentRequest,
  evidenceOf,
  keyExpired,
  mergeActionAllowed,
  mergeApproveRequest,
  mergeIssues,
  mergeRequest,
  moveActionAllowed,
  moveApproveRequest,
  payIssues,
  payRequest,
  pinIssues,
  reasonIssues,
  sameIntent,
  tagOf,
  type ApproveDraft,
  type ConsentDraft,
  type Evidence,
  type Failure,
  type FieldIssue,
  type Intent,
  type IntentKind,
  type MergeDraft,
  type Params,
  type PayDraft,
} from './model';
import type { Actor, Loaded, WalkOutPorts } from './port';

export type Phase =
  'loading' | 'ready' | 'refreshing' | 'forbidden' | 'expired' | 'error' | 'offline';

export type Command =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'failed'; failure: Failure; evidence: Evidence };

export interface Tagged<T> {
  view: T;
  tag: string;
}

export interface ControllerState {
  phase: Phase;
  actor: Actor | null;
  merge: Tagged<RoomMergeView> | null;
  move: Tagged<RoomMoveView> | null;
  payments: CompensationPaymentsView | null;
  command: Command;
  pending: boolean;
  /** Trạng thái ý định ghi do máy chủ báo khi tra theo khoá. */
  intentState: string | null;
  evidence: Evidence | null;
}

export interface ControllerOptions {
  ports: WalkOutPorts;
  params: Params;
  newKey?: () => string;
  now?: () => number;
}

export const INITIAL_STATE: ControllerState = {
  phase: 'loading',
  actor: null,
  merge: null,
  move: null,
  payments: null,
  command: { kind: 'idle' },
  pending: false,
  intentState: null,
  evidence: null,
};

const tagged = <T extends { version: number }>(loaded: Loaded<T>): Tagged<T> => ({
  view: loaded.view,
  tag: loaded.etag ?? tagOf(loaded.view.version),
});

interface Pin {
  code: string;
  bookingId: string;
}

export class WalkOutController {
  state: ControllerState = INITIAL_STATE;
  private pending: Intent | undefined;
  private mergeId: string;
  private moveId: string;
  private reads = new AbortController();
  private readEpoch = 0;
  private scope = 0;
  private alive = true;
  private readonly listeners = new Set<() => void>();
  private readonly newKey: () => string;
  private readonly now: () => number;

  constructor(private readonly options: ControllerOptions) {
    this.mergeId = options.params.mergeId;
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
    this.mergeId = '';
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
      const data = await this.read();
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

  private async read(): Promise<Partial<ControllerState>> {
    const { ports } = this.options;
    const out: Partial<ControllerState> = {};
    if (this.mergeId !== '') out.merge = tagged(await ports.merge(this.mergeId));
    if (this.moveId !== '') {
      out.move = tagged(await ports.move(this.moveId));
      out.payments = await ports.compensations(this.moveId);
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

  private intent(kind: IntentKind, target: string, body: unknown, ifMatch?: string): Intent {
    return { kind, target, body, ifMatch, key: this.newKey(), createdAt: this.now() };
  }

  /** Lập ghép: chỉ lễ tân; không cần `If-Match`. */
  submitMergeCreate(draft: MergeDraft): Promise<void> {
    const role = this.state.actor?.role;
    if (role === undefined || !can(role, 'create')) return this.blocked({ kind: 'forbidden' });
    const issues = mergeIssues(draft);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    return this.start(this.intent('mergeCreate', '', mergeRequest(draft)));
  }

  private mergeTarget(
    action: 'RECORD_CONSENT' | 'APPROVE' | 'EXECUTE',
  ): Tagged<RoomMergeView> | null {
    const { actor, merge } = this.state;
    if (actor === null || merge === null) return null;
    return mergeActionAllowed(actor.role, action, merge.view) ? merge : null;
  }

  submitConsent(draft: ConsentDraft): Promise<void> {
    const merge = this.mergeTarget('RECORD_CONSENT');
    if (merge === null) return this.blocked({ kind: 'forbidden' });
    const issues = consentIssues(draft);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    return this.start(this.intent('mergeConsent', merge.view.id, consentRequest(draft), merge.tag));
  }

  submitMergeApprove(reason: string): Promise<void> {
    const merge = this.mergeTarget('APPROVE');
    if (merge === null) return this.blocked({ kind: 'forbidden' });
    const issues = reasonIssues(reason);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    return this.start(
      this.intent('mergeApprove', merge.view.id, mergeApproveRequest(reason), merge.tag),
    );
  }

  submitMergeExecute(): Promise<void> {
    const merge = this.mergeTarget('EXECUTE');
    if (merge === null) return this.blocked({ kind: 'forbidden' });
    return this.start(this.intent('mergeExecute', merge.view.id, {}, merge.tag));
  }

  async submitMoveApprove(draft: ApproveDraft, pin: string): Promise<void> {
    const { actor, move } = this.state;
    if (actor === null || move === null || !moveActionAllowed(actor.role, 'APPROVE', move.view))
      return this.blocked({ kind: 'forbidden' });
    const issues = [...approveIssues(draft), ...pinIssues(pin)];
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    await this.pinned({ code: pin, bookingId: move.view.bookingId }, () =>
      this.intent('moveApprove', move.view.id, moveApproveRequest(draft), move.tag),
    );
  }

  async submitMoveExecute(pin: string): Promise<void> {
    const { actor, move } = this.state;
    if (actor === null || move === null || !moveActionAllowed(actor.role, 'EXECUTE', move.view))
      return this.blocked({ kind: 'forbidden' });
    const issues = pinIssues(pin);
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    await this.pinned({ code: pin, bookingId: move.view.bookingId }, () =>
      this.intent('moveExecute', move.view.id, {}, move.tag),
    );
  }

  /** Chi bồi thường: chỉ ACCOUNTANT, điều chuyển đã duyệt, chưa có khoản chi đang/đã chạy; không có ô số tiền. */
  async submitCompensate(draft: PayDraft, pin: string): Promise<void> {
    const { actor, move, payments } = this.state;
    if (
      actor === null ||
      move === null ||
      !canPayCompensation(actor.role, move.view, payments?.payments ?? [])
    )
      return this.blocked({ kind: 'forbidden' });
    const issues: FieldIssue[] = [...payIssues(draft), ...pinIssues(pin)];
    if (issues.length > 0) return this.blocked({ kind: 'validation', issues });
    await this.pinned({ code: pin, bookingId: move.view.bookingId }, () =>
      this.intent('compensate', move.view.id, payRequest(draft), move.tag),
    );
  }

  /** Đổi PIN lấy mã một lần (chỉ khi chưa có ý định treo), rồi mới tạo ý định; lỗi PIN không phải mất phiên. */
  private async pinned(pin: Pin, build: () => Intent): Promise<void> {
    if (this.pending === undefined) {
      try {
        await this.options.ports.verifyPin(pin.code, pin.bookingId);
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

  /** Tra kết quả theo khoá lệnh (`writeIntent`) trước khi gửi lại hay tạo lệnh mới. */
  async lookup(): Promise<void> {
    const intent = this.pending;
    if (intent === undefined || intent.target === '') return this.load();
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
    const { ports } = this.options;
    const merging = intent.kind.startsWith('merge');
    const loaded = merging
      ? await ports.merge(intent.target, intent.key)
      : await ports.move(intent.target, intent.key);
    return loaded.view.writeIntent?.state ?? null;
  }

  private async send(intent: Intent): Promise<void> {
    const stamp = this.scope;
    this.set({ command: { kind: 'sending' }, intentState: null });
    try {
      const result = await this.options.ports.send(intent);
      if (stamp !== this.scope) return;
      if (result.mergeId !== undefined) this.mergeId = result.mergeId;
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
    // Đồng thuận bị rút, phòng bị lấy, phiên bản đổi: đọc lại, giữ nguyên các nguồn, không tự đổi ACTIVE.
    if (['conflict', 'roomTaken', 'noConsent', 'mergeGender'].includes(failure.kind))
      void this.load();
  }
}
