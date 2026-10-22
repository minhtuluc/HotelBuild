/**
 * SCR-64 — gửi `POST /front-office/no-show`, **chỉ khi có mạng** (QĐ-03 quyết định 6): mất mạng thì không gửi,
 * không xếp hàng. Giữ một `Idempotency-Key` cho tới khi có kết quả chắc chắn; kết quả chưa xác định cho thử
 * lại **cùng khoá, cùng nội dung** (design §8.1). Khoá chỉ nằm trong RAM; sau khởi động lại, lễ tân tải lại
 * danh sách và máy chủ từ chối ghi lần hai (booking không còn CONFIRMED nên không sinh khoản phạt thứ hai).
 * Cùng khuôn với `arrivals/writer.ts`.
 */
import type { NoShowResponse } from '@pinehill/contracts';
import { actionFailure, type ActionFailure } from '../arrivals/model';
import type { NoShowBody } from './model';

export interface NoShowPorts {
  online(): Promise<boolean>;
  send(body: NoShowBody, idempotencyKey: string): Promise<NoShowResponse>;
  createId(): string;
}

export type NoShowOutcome =
  | { readonly kind: 'done'; readonly response: NoShowResponse }
  | { readonly kind: 'offline' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly failure: ActionFailure };

interface Pending {
  readonly fingerprint: string;
  readonly key: string;
}

export class NoShowWriter {
  private pending: Pending | null = null;
  private inFlight: Promise<NoShowOutcome> | null = null;
  private closed = false;
  constructor(private readonly ports: NoShowPorts) {}

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Quên khoá đang chờ (đổi phiên/cơ sở): một ý định cũ không được phát lại trong ngữ cảnh khác. */
  reset(): void {
    this.pending = null;
  }

  dispose(): void {
    this.closed = true;
    this.pending = null;
  }

  submit(body: NoShowBody): Promise<NoShowOutcome> {
    if (this.closed) return Promise.resolve({ kind: 'closed' });
    if (this.inFlight !== null) return this.inFlight;
    const running = this.run(body).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }

  private async online(): Promise<boolean> {
    try {
      return await this.ports.online();
    } catch {
      return false;
    }
  }

  private async run(body: NoShowBody): Promise<NoShowOutcome> {
    if (!(await this.online())) return { kind: 'offline' };
    const fingerprint = JSON.stringify(body);
    const key =
      this.pending?.fingerprint === fingerprint ? this.pending.key : this.ports.createId();
    this.pending = { fingerprint, key };
    try {
      const response = await this.ports.send(body, key);
      if (response.bookingId !== body.bookingId || response.status !== 'NO_SHOW')
        return { kind: 'failed', failure: { kind: 'unknownOutcome', reference: '—' } };
      this.pending = null;
      return { kind: 'done', response };
    } catch (caught) {
      const failure = actionFailure(caught);
      if (failure.kind !== 'unknownOutcome') this.pending = null;
      return { kind: 'failed', failure };
    }
  }
}
