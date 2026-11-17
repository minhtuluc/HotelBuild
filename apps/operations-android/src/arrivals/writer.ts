/**
 * SCR-58 — gửi `POST /front-office/check-in`, **chỉ khi có mạng** (QĐ-03 quyết định 6): mất mạng thì không
 * gửi, không xếp hàng, không báo thành công. Giữ một `Idempotency-Key` cho tới khi có kết quả chắc chắn;
 * kết quả chưa xác định (mất mạng sau khi gửi, hết giờ, 5xx) cho thử lại **cùng khoá, cùng nội dung**
 * (design §8.1). Khoá chỉ nằm trong RAM: sau khi khởi động lại, lễ tân tải lại danh sách và đối soát
 * (booking đã CHECKED_IN thì không còn trong danh sách đến); máy chủ từ chối lần nhận phòng thứ hai.
 */
import type { CheckInResponse, HousekeepingTaskCreateRequest } from '@pinehill/contracts';
import { actionFailure, type ActionFailure, type CheckInBody } from './model';

/** HB-251: biên bản đã kiểm phòng (`POST /housekeeping/tasks`, `status: INSPECTED`). */
export type InspectionBody = HousekeepingTaskCreateRequest & { readonly status: 'INSPECTED' };

export type InspectionOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'failed'; readonly failure: ActionFailure };

export interface CheckInPorts {
  online(): Promise<boolean>;
  send(body: CheckInBody, idempotencyKey: string): Promise<CheckInResponse>;
  /** Thiếu cổng này thì màn không đề nghị ghi biên bản (vd. bộ lắp test chỉ cần nhận phòng). */
  inspect?(body: InspectionBody, idempotencyKey: string): Promise<void>;
  createId(): string;
}

export type SubmitOutcome =
  | { readonly kind: 'done'; readonly response: CheckInResponse }
  | { readonly kind: 'offline' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'failed'; readonly failure: ActionFailure };

interface Pending {
  readonly fingerprint: string;
  readonly key: string;
}

export class CheckInWriter {
  private pending: Pending | null = null;
  private pendingInspection: Pending | null = null;
  private inFlight: Promise<SubmitOutcome> | null = null;
  private closed = false;
  constructor(private readonly ports: CheckInPorts) {}

  get canInspect(): boolean {
    return this.ports.inspect !== undefined;
  }

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

  submit(body: CheckInBody): Promise<SubmitOutcome> {
    if (this.closed) return Promise.resolve({ kind: 'closed' });
    if (this.inFlight !== null) return this.inFlight;
    const running = this.run(body).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = running;
    return running;
  }

  /**
   * HB-251 — ghi biên bản đã kiểm phòng, cùng quy tắc với nhận phòng: chỉ gửi khi có mạng, giữ khoá
   * `Idempotency-Key` khi kết quả chưa chắc để lần thử lại không tạo biên bản thứ hai.
   */
  async recordInspection(body: InspectionBody): Promise<InspectionOutcome> {
    const inspect = this.ports.inspect;
    if (inspect === undefined) return { kind: 'failed', failure: { kind: 'forbidden' } };
    if (!(await this.online())) return { kind: 'offline' };
    const fingerprint = JSON.stringify(body);
    const key =
      this.pendingInspection?.fingerprint === fingerprint
        ? this.pendingInspection.key
        : this.ports.createId();
    this.pendingInspection = { fingerprint, key };
    try {
      await inspect.call(this.ports, body, key);
      this.pendingInspection = null;
      return { kind: 'done' };
    } catch (caught) {
      const failure = actionFailure(caught);
      if (failure.kind !== 'unknownOutcome') this.pendingInspection = null;
      return { kind: 'failed', failure };
    }
  }

  private async online(): Promise<boolean> {
    try {
      return await this.ports.online();
    } catch {
      return false;
    }
  }

  private async run(body: CheckInBody): Promise<SubmitOutcome> {
    if (!(await this.online())) return { kind: 'offline' };
    const fingerprint = JSON.stringify(body);
    const key =
      this.pending?.fingerprint === fingerprint ? this.pending.key : this.ports.createId();
    this.pending = { fingerprint, key };
    try {
      const response = await this.ports.send(body, key);
      if (response.bookingId !== body.bookingId || response.status !== 'CHECKED_IN')
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
