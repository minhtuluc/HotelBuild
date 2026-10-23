/**
 * Số xem trước do máy chủ trả (HB-209) cho SCR-61/SCR-64. Lớp thuần: nhận hàm gọi mạng nên test không cần
 * mạng. Quy tắc về tiền: **không giữ số cũ** khi đang tải lại hay khi lỗi (không bao giờ hiện số của lựa chọn
 * trước, không bao giờ hiện 0 thay cho "chưa biết"); phản hồi của yêu cầu cũ đến muộn bị bỏ; phản hồi của
 * booking khác bị coi là lỗi. Số xem trước không ràng buộc: lệnh ghi tính lại sau khoá (ADR-014).
 */
import { type ReadFailure, readFailure } from '../stay/model';
import { OfflineError } from '../netinfo';

export type PreviewPhase = 'idle' | 'loading' | 'ready' | ReadFailure;

export interface PreviewState<T> {
  readonly phase: PreviewPhase;
  readonly value: T | null;
}

function failure(error: unknown): ReadFailure {
  return error instanceof OfflineError ? 'offline' : readFailure(error);
}

export class PreviewReader<T extends { bookingId: string }> {
  state: PreviewState<T> = { phase: 'idle', value: null };
  private epoch = 0;
  private alive = true;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(next: PreviewState<T>): void {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  invalidate(): void {
    this.epoch++;
    this.update({ phase: 'idle', value: null });
  }

  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.listeners.clear();
  }

  async load(bookingId: string, run: () => Promise<T>): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    this.update({ phase: 'loading', value: null });
    try {
      const value = await run();
      if (stamp !== this.epoch) return;
      this.update(
        value.bookingId === bookingId ? { phase: 'ready', value } : { phase: 'error', value: null },
      );
    } catch (error) {
      if (stamp === this.epoch) this.update({ phase: failure(error), value: null });
    }
  }
}
