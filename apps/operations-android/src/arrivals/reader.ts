/**
 * SCR-57 — nạp danh sách khách đến hôm nay từ hai tuyến đọc có sẵn (`GET /bookings`, `GET /rooms`).
 *
 * Lớp thuần, nhận `ArrivalsPorts` để test không cần mạng. Chống ghi đè bởi phản hồi cũ (§8.1) và giữ
 * **bộ nhớ đệm chỉ nằm trong RAM** (`ArrivalsCache`): khi mất mạng/lỗi tải lại, danh sách đã tải được giữ
 * cùng mốc đồng bộ; không ghi ra đĩa vì lưu trữ nhạy cảm/TTL còn chờ OPEN-02 (design §8.3). Cache bị xoá
 * khi đăng xuất, khi 401/403 và không bao giờ dùng cho cơ sở hoặc ngày nghiệp vụ khác.
 */
import { isApiError } from '@pinehill/api-client';
import type { BookingSummary, ListPage, RoomSummary } from '@pinehill/contracts';
import { todayVN } from '../housekeeping/reader';
import { OfflineError } from '../netinfo';
import { arrivalsOf } from './model';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export interface ArrivalsPorts {
  /** Đồng hồ thiết bị chỉ dùng chọn **ngày lọc** và nhãn đồng bộ; máy chủ quyết định mọi luật theo giờ. */
  now(): Date;
  bookings(query: {
    propertyId?: string;
    from: string;
    to: string;
    limit: number;
    cursor?: string;
  }): Promise<ListPage<BookingSummary>>;
  rooms(query: {
    propertyId?: string;
    status: 'ACTIVE';
    limit: number;
    cursor?: string;
  }): Promise<ListPage<RoomSummary>>;
}

export type ArrivalsPhase =
  'idle' | 'loading' | 'ready' | 'empty' | 'offline' | 'expired' | 'forbidden' | 'error';

export interface ArrivalsState {
  readonly phase: ArrivalsPhase;
  readonly arrivals: readonly BookingSummary[];
  readonly rooms: readonly RoomSummary[];
  readonly date: string | null;
  /** Mốc thiết bị nhận phản hồi thành công gần nhất (ISO UTC) — nhãn "đồng bộ lúc", không phải giờ nghiệp vụ. */
  readonly syncedAt: string | null;
  /** Đang hiển thị bản đã tải trước đó vì lần tải lại thất bại. */
  readonly stale: boolean;
  readonly notice: 'offline' | 'error' | null;
  /** Máy chủ còn trang sau giới hạn đọc của màn hình. */
  readonly truncated: boolean;
}

const IDLE: ArrivalsState = {
  phase: 'idle',
  arrivals: [],
  rooms: [],
  date: null,
  syncedAt: null,
  stale: false,
  notice: null,
  truncated: false,
};

interface CacheEntry {
  readonly propertyId: string | null;
  readonly date: string;
  readonly arrivals: readonly BookingSummary[];
  readonly rooms: readonly RoomSummary[];
  readonly syncedAt: string;
  readonly truncated: boolean;
}

/** Cache chỉ-RAM, dùng chung giữa các lần mở màn hình trong cùng phiên; chủ phiên gọi `clear()` khi đăng xuất. */
export class ArrivalsCache {
  private entry: CacheEntry | null = null;
  get(propertyId: string | null, date: string): CacheEntry | null {
    const entry = this.entry;
    return entry !== null && entry.propertyId === propertyId && entry.date === date ? entry : null;
  }
  put(entry: CacheEntry): void {
    this.entry = entry;
  }
  clear(): void {
    this.entry = null;
  }
}

function failure(error: unknown): 'offline' | 'expired' | 'forbidden' | 'error' {
  if (error instanceof OfflineError) return 'offline';
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'aborted') return 'offline';
  if (error.status === 401) return 'expired';
  if (error.status === 403) return 'forbidden';
  return 'error';
}

async function collect<T>(
  load: (cursor: string | undefined) => Promise<ListPage<T>>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const loaded = await load(cursor);
    rows.push(...loaded.data);
    cursor = loaded.meta.hasMore ? (loaded.meta.nextCursor ?? undefined) : undefined;
    if (cursor === undefined) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

function fromEntry(
  entry: CacheEntry,
  stale: boolean,
  notice: ArrivalsState['notice'],
): ArrivalsState {
  return {
    phase: entry.arrivals.length === 0 ? 'empty' : 'ready',
    arrivals: entry.arrivals,
    rooms: entry.rooms,
    date: entry.date,
    syncedAt: entry.syncedAt,
    stale,
    notice,
    truncated: entry.truncated,
  };
}

export class ArrivalsReader {
  state: ArrivalsState = IDLE;
  private epoch = 0;
  private alive = true;
  private listeners = new Set<() => void>();
  constructor(
    private readonly ports: ArrivalsPorts,
    private readonly cache: ArrivalsCache,
  ) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(next: ArrivalsState): void {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  invalidate(): void {
    this.epoch++;
    this.update(IDLE);
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.listeners.clear();
  }
  async load(propertyId?: string): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    const date = todayVN(this.ports.now());
    const scope = propertyId ?? null;
    this.update({ ...this.state, phase: 'loading', date });
    try {
      const [bookings, rooms] = await Promise.all([
        collect((cursor) =>
          this.ports.bookings({
            ...(propertyId === undefined ? {} : { propertyId }),
            from: date,
            to: date,
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
        collect((cursor) =>
          this.ports.rooms({
            ...(propertyId === undefined ? {} : { propertyId }),
            status: 'ACTIVE',
            limit: PAGE_LIMIT,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      ]);
      if (stamp !== this.epoch) return;
      const entry: CacheEntry = {
        propertyId: scope,
        date,
        arrivals: arrivalsOf(bookings.rows, date),
        rooms: rooms.rows,
        syncedAt: this.ports.now().toISOString(),
        truncated: bookings.truncated || rooms.truncated,
      };
      this.cache.put(entry);
      this.update(fromEntry(entry, false, null));
    } catch (error) {
      if (stamp !== this.epoch) return;
      this.fail(failure(error), scope, date);
    }
  }
  private fail(phase: ReturnType<typeof failure>, scope: string | null, date: string): void {
    if (phase === 'expired' || phase === 'forbidden') {
      // Phiên hết hạn/thu hồi quyền: không để lộ PII từ bản cũ.
      this.cache.clear();
      this.update({ ...IDLE, phase, date });
      return;
    }
    const cached = this.cache.get(scope, date);
    if (cached !== null) {
      this.update(fromEntry(cached, true, phase));
      return;
    }
    this.update({ ...IDLE, phase, date });
  }
}
