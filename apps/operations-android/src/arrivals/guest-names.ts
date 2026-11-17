/**
 * SCR-57 — tên và hạng thành viên khách trên thẻ, đọc theo id qua `GET /guests/{guestId}` (HB-208, đóng TD-33;
 * hạng từ HB-328, TD-34). Chỉ giữ **họ tên và hạng** trong RAM của màn hình (không SĐT/email/điểm, không ghi
 * đĩa); xoá khi đổi phiên/cơ sở. Tải có giới hạn
 * đồng thời để một danh sách dài không làm nghẽn mạng. Lỗi không bao giờ chặn thẻ hay check-in: 403/404
 * (không có/ngoài phạm vi) nhớ là "không tên" và không hỏi lại; mất mạng/5xx/401 thử lại ở lần `ensure` sau.
 */
import { isApiError } from '@pinehill/api-client';
import type { GuestSummary, LoyaltyTier } from '@pinehill/contracts';

export const NAME_CONCURRENCY = 4;

const PERMANENT = new Set([403, 404]);

interface GuestCardInfo {
  readonly fullName: string;
  readonly tier: LoyaltyTier;
}

export class GuestNames {
  private names = new Map<string, GuestCardInfo | null>();
  private pending = new Set<string>();
  private epoch = 0;
  private alive = true;
  private listeners = new Set<() => void>();

  constructor(private readonly fetchGuest: (guestId: string) => Promise<GuestSummary>) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    if (!this.alive) return;
    for (const listener of this.listeners) listener();
  }

  /** `null` = chưa có hoặc không có tên; thẻ vẫn hiện bình thường. */
  get(guestId: string): string | null {
    return this.names.get(guestId)?.fullName ?? null;
  }

  /** Hạng thành viên do máy chủ trả (không tự suy); `null` khi chưa đọc được hồ sơ. */
  tier(guestId: string): LoyaltyTier | null {
    return this.names.get(guestId)?.tier ?? null;
  }

  clear(): void {
    this.epoch++;
    this.names = new Map();
    this.pending = new Set();
    this.notify();
  }

  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.names = new Map();
    this.pending = new Set();
    this.listeners.clear();
  }

  async ensure(guestIds: readonly string[]): Promise<void> {
    if (!this.alive) return;
    const todo = [...new Set(guestIds)].filter(
      (id) => !this.names.has(id) && !this.pending.has(id),
    );
    if (todo.length === 0) return;
    const stamp = this.epoch;
    for (const id of todo) this.pending.add(id);
    const queue = [...todo];
    const worker = async (): Promise<void> => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        if (stamp !== this.epoch) return;
        await this.load(id, stamp);
      }
    };
    await Promise.all(Array.from({ length: Math.min(NAME_CONCURRENCY, todo.length) }, worker));
  }

  private async load(id: string, stamp: number): Promise<void> {
    let name: GuestCardInfo | null | undefined;
    try {
      const guest = await this.fetchGuest(id);
      name = guest.id === id ? { fullName: guest.fullName, tier: guest.loyaltyTier } : null;
    } catch (error) {
      name = isApiError(error) && PERMANENT.has(error.status ?? 0) ? null : undefined;
    }
    if (stamp !== this.epoch) return;
    this.pending.delete(id);
    if (name !== undefined) this.names.set(id, name);
    this.notify();
  }
}
