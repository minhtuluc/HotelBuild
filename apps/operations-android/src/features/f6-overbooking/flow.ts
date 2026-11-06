/**
 * Luồng thao tác của SCR-63 (không React, kiểm bằng vitest): chọn phương án → lập điều chuyển (lễ tân) →
 * PIN → thực hiện (lễ tân) hoặc duyệt (quản lý). Mọi kết quả hiển thị đến từ phản hồi máy chủ: chỉ
 * trạng thái `EXECUTED` mới là hoàn tất; lỗi đích bị lấy/đồng ý bị rút/phiên bản đổi giữ phòng nguồn và ca
 * mở, đọc lại phương án và **không** tự thử bậc khác. Mất mạng: không gửi, không xếp hàng.
 */
import type { UserMe } from '@pinehill/contracts';
import {
  actionAllowed,
  canCreate,
  createBody,
  draftIssues,
  pinShapeOk,
  type DraftIssue,
  type Failure,
  type MoveContext,
  type MoveDraft,
} from './model';
import type { F6Ports } from './ports';
import { RelocationReader } from './reader';
import { MoveWriter, type Intent, type SubmitOutcome } from './writer';

export type PinAction = 'approve' | 'execute';

export type Command =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'done' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'ttl' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'invalid'; readonly issues: readonly DraftIssue[] }
  | { readonly kind: 'failed'; readonly failure: Failure };

export type PinMessage =
  'wrong' | 'locked' | 'shape' | 'offline' | 'expired' | 'unavailable' | null;

export interface FlowState {
  readonly picked: number | null;
  readonly draft: MoveDraft;
  readonly command: Command;
  readonly pinFor: PinAction | null;
  readonly pinMessage: PinMessage;
  readonly lockedFor: number | null;
  readonly intentState: string | null;
}

const INITIAL: FlowState = {
  picked: null,
  draft: { reason: '', granted: false },
  command: { kind: 'idle' },
  pinFor: null,
  pinMessage: null,
  lockedFor: null,
  intentState: null,
};

export class RelocationFlow {
  state: FlowState = INITIAL;
  readonly reader: RelocationReader;
  readonly writer: MoveWriter;
  private readonly listeners = new Set<() => void>();
  private closed = false;
  constructor(
    ports: F6Ports,
    private readonly role: UserMe['role'],
    private readonly ctx: MoveContext,
  ) {
    this.reader = new RelocationReader(ports);
    this.writer = new MoveWriter(ports);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<FlowState>): void {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Đổi phiên/cơ sở/rời màn hình: bỏ PIN, khoá chờ, phương án đã chọn và dữ liệu đã đọc. */
  reset(): void {
    this.writer.reset();
    this.reader.invalidate();
    this.set(INITIAL);
  }

  dispose(): void {
    this.closed = true;
    this.writer.dispose();
    this.reader.dispose();
    this.listeners.clear();
  }

  load(moveId: string): Promise<void> {
    return this.reader.load(this.role, {
      caseId: this.ctx.caseId,
      bookingId: this.ctx.bookingId,
      moveId,
    });
  }

  pick(index: number): void {
    this.set({ picked: index, command: { kind: 'idle' } });
  }

  edit(draft: MoveDraft): void {
    this.set({ draft });
  }

  /** Lập điều chuyển (lễ tân): số tiền lấy nguyên từ phương án máy chủ; thiếu lý do/đồng ý thì không gửi. */
  async create(): Promise<void> {
    const option =
      this.state.picked === null
        ? undefined
        : this.reader.state.options?.options[this.state.picked];
    const issues = draftIssues(this.state.draft, option);
    if (!canCreate(this.role) || option === undefined || issues.length > 0)
      return this.set({ command: { kind: 'invalid', issues } });
    const intent: Intent = { kind: 'create', body: createBody(this.ctx, option, this.state.draft) };
    await this.send(intent);
  }

  /** Mở ô PIN cho hành động cần PIN; chỉ khi máy chủ cho phép (`allowedActions`) và đúng quyền riêng. */
  askPin(action: PinAction): void {
    const move = this.reader.state.move;
    const allowed =
      move !== null &&
      actionAllowed(this.role, action === 'approve' ? 'APPROVE' : 'EXECUTE', move.view);
    if (allowed) this.set({ pinFor: action, pinMessage: null, command: { kind: 'idle' } });
  }

  cancelPin(): void {
    this.writer.reset();
    this.set({ pinFor: null, pinMessage: null });
  }

  /** Đổi PIN lấy mã một lần trong RAM rồi gửi lệnh; PIN không bao giờ vào state. */
  async submitPin(pin: string): Promise<void> {
    const move = this.reader.state.move;
    const action = this.state.pinFor;
    if (move === null || action === null) return;
    if (!pinShapeOk(pin)) return this.set({ pinMessage: 'shape' });
    const outcome = await this.writer.unlock(pin, move.view.bookingId);
    if (outcome.kind !== 'unlocked') return this.set(this.pinFailure(outcome));
    const intent: Intent =
      action === 'approve'
        ? {
            kind: 'approve',
            moveId: move.view.id,
            etag: move.tag,
            body: {
              compensationAmount: move.view.compensationAmount,
              transportCost: move.view.transportCost,
            },
          }
        : { kind: 'execute', moveId: move.view.id, etag: move.tag };
    this.set({ pinMessage: null });
    await this.send(intent);
  }

  private pinFailure(
    outcome: Exclude<Awaited<ReturnType<MoveWriter['unlock']>>, { kind: 'unlocked' }>,
  ): Partial<FlowState> {
    if (outcome.kind === 'locked') {
      this.writer.reset();
      return { pinMessage: 'locked', lockedFor: outcome.retryAfterSeconds };
    }
    if (outcome.kind === 'expired') this.writer.reset();
    const map = {
      wrong: 'wrong',
      offline: 'offline',
      expired: 'expired',
      unavailable: 'unavailable',
      closed: 'unavailable',
    } as const;
    return { pinMessage: map[outcome.kind] };
  }

  /** Gửi lại đúng ý định đang chờ (cùng khoá/thân/If-Match). */
  async retry(): Promise<void> {
    this.set({ command: { kind: 'sending' } });
    await this.settle(await this.resend());
  }

  private async resend(): Promise<SubmitOutcome> {
    return this.writer.resubmit(this.ctx.bookingId, this.ctx.caseId);
  }

  async lookup(): Promise<void> {
    const outcome = await this.writer.lookup();
    if (outcome.kind === 'state') {
      this.set({ intentState: outcome.state });
      if (outcome.state === 'SUCCEEDED' || outcome.state === 'FAILED') {
        this.set({ command: { kind: 'idle' } });
        await this.reload();
      }
    } else if (outcome.kind === 'offline') this.set({ command: { kind: 'offline' } });
  }

  discard(): void {
    this.writer.discard();
    this.set({ command: { kind: 'idle' }, intentState: null, pinFor: null });
  }

  private async send(intent: Intent): Promise<void> {
    this.set({ command: { kind: 'sending' }, intentState: null });
    await this.settle(await this.writer.submit(intent, this.ctx.bookingId, this.ctx.caseId));
  }

  private async settle(outcome: SubmitOutcome): Promise<void> {
    if (outcome.kind === 'done') {
      this.reader.follow(outcome.move.id);
      this.set({ command: { kind: 'done' }, pinFor: null });
      return this.reload();
    }
    if (outcome.kind === 'pinRequired')
      return this.set({ command: { kind: 'idle' }, pinMessage: 'wrong' });
    if (outcome.kind === 'failed') {
      this.set({ command: { kind: 'failed', failure: outcome.failure } });
      return this.reloadAfter(outcome.failure);
    }
    this.set({ command: outcome.kind === 'closed' ? { kind: 'idle' } : { kind: outcome.kind } });
  }

  /** Đích bị lấy/đồng ý bị rút/phiên bản đổi: đọc lại phương án, giữ nguồn, không tự thử bậc khác. */
  private async reloadAfter(failure: Failure): Promise<void> {
    if (['roomTaken', 'noConsent', 'conflict'].includes(failure.kind)) await this.reload();
  }

  private reload(): Promise<void> {
    return this.load(this.reader.state.move?.view.id ?? '');
  }
}
