/**
 * Lệnh ghi của SCR-63 (lập/duyệt/thực hiện điều chuyển): **chỉ khi có mạng**, không xếp hàng (QĐ-03 quyết
 * định 6). Mỗi ý định giữ một `Idempotency-Key`, thân và `If-Match` ổn định cho tới khi có kết quả chắc
 * chắn; chưa rõ kết quả (mất mạng sau gửi, hết giờ, 5xx) thì thử lại **đúng lệnh đó** hoặc tra theo
 * `writeIntent`, không bao giờ tạo lệnh khác. Quá 24 giờ phải tra chứng từ trước. `pinToken` chỉ nằm trong
 * RAM của writer và bị bỏ sau mọi kết quả chắc chắn, khi rời màn hình hoặc đổi phiên (không ghi đĩa).
 */
import type { RoomMove, RoomMoveApproveRequest, RoomMoveCreateRequest } from '@pinehill/contracts';
import { pinUnlockFailure } from '../../stay/model';
import type { UnlockOutcome } from '../../stay/writer';
import { KEY_TTL_MS, moveFailure, settled, type Failure } from './model';
import type { F6Ports } from './ports';

export type Intent =
  | { readonly kind: 'create'; readonly body: RoomMoveCreateRequest }
  | {
      readonly kind: 'approve';
      readonly moveId: string;
      readonly body: RoomMoveApproveRequest;
      readonly etag: string;
    }
  | { readonly kind: 'execute'; readonly moveId: string; readonly etag: string };

export type SubmitOutcome =
  | { readonly kind: 'done'; readonly move: RoomMove }
  | { readonly kind: 'offline' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'pinRequired' }
  | { readonly kind: 'ttl' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'failed'; readonly failure: Failure };

export type LookupOutcome =
  | { readonly kind: 'state'; readonly state: string }
  | { readonly kind: 'offline' }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly failure: Failure };

interface Pending {
  readonly fingerprint: string;
  readonly key: string;
  readonly createdAt: number;
  readonly intent: Intent;
  readonly bookingId: string;
  readonly caseId: string;
}

const needsPin = (intent: Intent): boolean => intent.kind !== 'create';

export class MoveWriter {
  private token: string | null = null;
  private pending: Pending | null = null;
  private inFlight: Promise<SubmitOutcome> | null = null;
  private closed = false;
  constructor(private readonly ports: F6Ports) {}

  get unlocked(): boolean {
    return this.token !== null;
  }
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Quên PIN và ý định (đổi phiên/cơ sở, rời màn hình): ý định cũ không được phát lại ở ngữ cảnh khác. */
  reset(): void {
    this.token = null;
    this.pending = null;
  }

  dispose(): void {
    this.closed = true;
    this.reset();
  }

  /** Bỏ có chủ đích ý định chưa rõ (sau khi đã tra kết quả). */
  discard(): void {
    this.pending = null;
    this.token = null;
  }

  private async online(): Promise<boolean> {
    try {
      return await this.ports.online();
    } catch {
      return false;
    }
  }

  async unlock(pin: string, bookingId: string): Promise<UnlockOutcome> {
    if (this.closed) return { kind: 'closed' };
    if (!(await this.online())) return { kind: 'offline' };
    try {
      this.token = await this.ports.verifyPin(pin, bookingId);
      return { kind: 'unlocked' };
    } catch (caught) {
      this.token = null;
      return pinUnlockFailure(caught);
    }
  }

  submit(intent: Intent, bookingId: string, caseId: string): Promise<SubmitOutcome> {
    if (this.closed) return Promise.resolve({ kind: 'closed' });
    if (this.inFlight !== null) return this.inFlight;
    const running = this.run(intent, bookingId, caseId).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }

  private choose(intent: Intent, bookingId: string, caseId: string): Pending | 'blocked' {
    const fingerprint = JSON.stringify(intent);
    if (this.pending === null)
      return {
        fingerprint,
        key: this.ports.createId(),
        createdAt: this.ports.now().getTime(),
        intent,
        bookingId,
        caseId,
      };
    // Còn ý định chưa rõ: chỉ được gửi lại đúng nó; ý định khác bị chặn cho tới khi tra/bỏ.
    return this.pending.fingerprint === fingerprint ? this.pending : 'blocked';
  }

  private async run(intent: Intent, bookingId: string, caseId: string): Promise<SubmitOutcome> {
    if (needsPin(intent) && this.token === null) return { kind: 'pinRequired' };
    if (!(await this.online())) return { kind: 'offline' };
    const chosen = this.choose(intent, bookingId, caseId);
    if (chosen === 'blocked') return { kind: 'blocked' };
    if (this.ports.now().getTime() - chosen.createdAt >= KEY_TTL_MS) return { kind: 'ttl' };
    this.pending = chosen;
    try {
      const move = await this.dispatch(intent, chosen.key);
      this.discard();
      return { kind: 'done', move };
    } catch (caught) {
      const failure = moveFailure(caught);
      if (failure.kind === 'pinRequired') this.reset();
      else if (settled(failure)) this.discard();
      return failure.kind === 'pinRequired' ? { kind: 'pinRequired' } : { kind: 'failed', failure };
    }
  }

  private dispatch(intent: Intent, key: string): Promise<RoomMove> {
    if (intent.kind === 'create') return this.ports.create(intent.body, key);
    const token = this.token ?? '';
    return intent.kind === 'approve'
      ? this.ports.approve(intent.moveId, intent.body, token, intent.etag, key)
      : this.ports.execute(intent.moveId, token, intent.etag, key);
  }

  /** Gửi lại đúng ý định đang chờ (cùng khoá/thân/If-Match); không có ý định thì không làm gì. */
  resubmit(bookingId: string, caseId: string): Promise<SubmitOutcome> {
    const pending = this.pending;
    return pending === null
      ? Promise.resolve({ kind: 'blocked' })
      : this.submit(pending.intent, bookingId, caseId);
  }

  /** Tra kết quả ý định chưa rõ theo khoá (`writeIntent`) trước khi gửi lại hay tạo lệnh mới (AC6). */
  async lookup(): Promise<LookupOutcome> {
    const pending = this.pending;
    if (pending === null) return { kind: 'none' };
    if (!(await this.online())) return { kind: 'offline' };
    try {
      const state = await this.readIntent(pending);
      if (state === 'SUCCEEDED' || state === 'FAILED') this.discard();
      return { kind: 'state', state };
    } catch (caught) {
      return { kind: 'failed', failure: moveFailure(caught) };
    }
  }

  private async readIntent(pending: Pending): Promise<string> {
    const { intent } = pending;
    const written =
      intent.kind === 'create'
        ? (await this.ports.options(pending.bookingId, pending.caseId, pending.key)).writeIntent
        : (await this.ports.move(intent.moveId, pending.key)).view.writeIntent;
    return written?.state ?? 'NOT_FOUND';
  }
}
