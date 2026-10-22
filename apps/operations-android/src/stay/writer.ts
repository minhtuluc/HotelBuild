/**
 * Lệnh 🔒 PIN của SCR-59 (`POST /payments`) và SCR-61 (`POST /front-office/check-out`): **chỉ khi có mạng**,
 * không xếp hàng (QĐ-03 quyết định 6). `pinToken` dùng một lần, chỉ nằm trong RAM của writer và bị bỏ sau
 * mọi kết quả chắc chắn. Kết quả chưa xác định (timeout, mất mạng sau khi gửi, 5xx, phản hồi lệch) giữ
 * token + `Idempotency-Key` + nội dung để người dùng thử lại **đúng lệnh đó** (design §8.1); mọi ý định mới
 * dùng khoá mới và PIN mới. Không ghi đĩa: sau khi khởi động lại phải đối soát bằng cách đọc lại dữ liệu.
 */
import type { ActionFailure } from '../arrivals/model';
import { actionFailure } from '../arrivals/model';
import { isPinRequired, pinUnlockFailure } from './model';

export interface PinnedPorts<B, R> {
  online(): Promise<boolean>;
  /** Trả `pinToken` gắn người + booking (BR-RBAC-05); ném lỗi API khi sai/khoá. */
  verifyPin(pin: string, bookingId: string): Promise<string>;
  send(body: B, pinToken: string, idempotencyKey: string): Promise<R>;
  createId(): string;
  /** Phản hồi có đúng là kết quả của lệnh vừa gửi không (đối tượng/trạng thái). */
  matches(body: B, response: R): boolean;
}

export type UnlockOutcome =
  | { readonly kind: 'unlocked' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'locked'; readonly retryAfterSeconds: number | null }
  | { readonly kind: 'expired' }
  | { readonly kind: 'unavailable' };

export type SubmitOutcome<R> =
  | { readonly kind: 'done'; readonly response: R }
  | { readonly kind: 'offline' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'pinRequired' }
  | { readonly kind: 'failed'; readonly failure: ActionFailure };

interface Pending {
  readonly fingerprint: string;
  readonly key: string;
}

export class PinnedWriter<B, R> {
  private token: string | null = null;
  private pending: Pending | null = null;
  private inFlight: Promise<SubmitOutcome<R>> | null = null;
  private closed = false;
  constructor(private readonly ports: PinnedPorts<B, R>) {}

  get unlocked(): boolean {
    return this.token !== null;
  }

  /** Quên token và khoá chờ (đổi phiên/cơ sở): ý định cũ không được phát lại ở ngữ cảnh khác. */
  reset(): void {
    this.token = null;
    this.pending = null;
  }

  dispose(): void {
    this.closed = true;
    this.reset();
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

  submit(body: B): Promise<SubmitOutcome<R>> {
    if (this.closed) return Promise.resolve({ kind: 'closed' });
    if (this.inFlight !== null) return this.inFlight;
    const running = this.run(body).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }

  private async run(body: B): Promise<SubmitOutcome<R>> {
    const token = this.token;
    if (token === null) return { kind: 'pinRequired' };
    if (!(await this.online())) return { kind: 'offline' };
    const fingerprint = JSON.stringify(body);
    const key =
      this.pending?.fingerprint === fingerprint ? this.pending.key : this.ports.createId();
    this.pending = { fingerprint, key };
    try {
      const response = await this.ports.send(body, token, key);
      if (!this.ports.matches(body, response))
        return { kind: 'failed', failure: { kind: 'unknownOutcome', reference: '—' } };
      this.reset();
      return { kind: 'done', response };
    } catch (caught) {
      if (isPinRequired(caught)) {
        this.reset();
        return { kind: 'pinRequired' };
      }
      const failure = actionFailure(caught);
      if (failure.kind !== 'unknownOutcome') this.reset();
      return { kind: 'failed', failure };
    }
  }
}
