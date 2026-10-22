/**
 * SCR-60 — danh sách khách đi (đang ở, đến hạn trả hôm nay hoặc quá hạn) từ `GET /bookings?status=CHECKED_IN`,
 * và SCR-59/61 — số dư do máy chủ trả từ `GET /bookings/{id}/balance`.
 *
 * Lớp thuần nhận port để test không cần mạng; chống ghi đè bởi phản hồi cũ (§8.1). Bản đã tải chỉ sống
 * trong đối tượng reader (RAM của màn hình): lỗi tải lại giữ danh sách cũ kèm mốc đồng bộ, không ghi đĩa,
 * không dùng cho cơ sở/ngày khác, và 401/403 bỏ ngay (không để lộ PII). Số dư tiền thì **không** giữ bản cũ.
 */
import type { BookingBalance, BookingSummary, ListPage } from '@pinehill/contracts';
import { todayVN } from '../housekeeping/reader';
import { departuresOf, readFailure, type ReadFailure } from './model';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export interface DeparturesPorts {
  /** Chỉ chọn ngày lọc và nhãn đồng bộ; máy chủ quyết định mọi luật theo giờ. */
  now(): Date;
  bookings(query: {
    propertyId?: string;
    status: 'CHECKED_IN';
    limit: number;
    cursor?: string;
  }): Promise<ListPage<BookingSummary>>;
}

export type DeparturesPhase = 'idle' | 'loading' | 'ready' | 'empty' | ReadFailure;

export interface DeparturesState {
  readonly phase: DeparturesPhase;
  readonly departures: readonly BookingSummary[];
  readonly date: string | null;
  readonly syncedAt: string | null;
  readonly stale: boolean;
  readonly notice: 'offline' | 'error' | null;
  readonly truncated: boolean;
}

const IDLE: DeparturesState = {
  phase: 'idle',
  departures: [],
  date: null,
  syncedAt: null,
  stale: false,
  notice: null,
  truncated: false,
};

interface Loaded {
  readonly propertyId: string | null;
  readonly date: string;
  readonly departures: readonly BookingSummary[];
  readonly syncedAt: string;
  readonly truncated: boolean;
}

function fromLoaded(
  loaded: Loaded,
  stale: boolean,
  notice: DeparturesState['notice'],
): DeparturesState {
  return {
    phase: loaded.departures.length === 0 ? 'empty' : 'ready',
    departures: loaded.departures,
    date: loaded.date,
    syncedAt: loaded.syncedAt,
    stale,
    notice,
    truncated: loaded.truncated,
  };
}

async function collect(
  load: (cursor: string | undefined) => Promise<ListPage<BookingSummary>>,
): Promise<{ rows: BookingSummary[]; truncated: boolean }> {
  const rows: BookingSummary[] = [];
  let cursor: string | undefined;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const loaded = await load(cursor);
    rows.push(...loaded.data);
    cursor = loaded.meta.hasMore ? (loaded.meta.nextCursor ?? undefined) : undefined;
    if (cursor === undefined) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

abstract class Observable<S> {
  abstract state: S;
  protected epoch = 0;
  protected alive = true;
  private listeners = new Set<() => void>();
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  protected update(next: S): void {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  protected abstract idle(): S;
  invalidate(): void {
    this.epoch++;
    this.update(this.idle());
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.listeners.clear();
  }
}

export class DeparturesReader extends Observable<DeparturesState> {
  state: DeparturesState = IDLE;
  private last: Loaded | null = null;
  constructor(private readonly ports: DeparturesPorts) {
    super();
  }
  protected idle(): DeparturesState {
    return IDLE;
  }
  async load(propertyId?: string): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    const date = todayVN(this.ports.now());
    const scope = propertyId ?? null;
    this.update({ ...this.state, phase: 'loading', date });
    try {
      const loaded = await collect((cursor) =>
        this.ports.bookings({
          ...(propertyId === undefined ? {} : { propertyId }),
          status: 'CHECKED_IN',
          limit: PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      if (stamp !== this.epoch) return;
      this.last = {
        propertyId: scope,
        date,
        departures: departuresOf(loaded.rows, date),
        syncedAt: this.ports.now().toISOString(),
        truncated: loaded.truncated,
      };
      this.update(fromLoaded(this.last, false, null));
    } catch (error) {
      if (stamp === this.epoch) this.fail(readFailure(error), scope, date);
    }
  }
  private fail(phase: ReadFailure, scope: string | null, date: string): void {
    if (phase === 'expired' || phase === 'forbidden') this.last = null;
    const kept = this.last;
    const reusable = kept !== null && kept.propertyId === scope && kept.date === date;
    if (reusable && (phase === 'offline' || phase === 'error')) {
      this.update(fromLoaded(kept, true, phase));
      return;
    }
    this.update({ ...IDLE, phase, date });
  }
}

export interface BalancePorts {
  balance(bookingId: string): Promise<BookingBalance>;
}

export type BalancePhase = 'idle' | 'loading' | 'ready' | ReadFailure;

export interface BalanceState {
  readonly phase: BalancePhase;
  readonly balance: BookingBalance | null;
}

const BALANCE_IDLE: BalanceState = { phase: 'idle', balance: null };

export class BalanceReader extends Observable<BalanceState> {
  state: BalanceState = BALANCE_IDLE;
  constructor(private readonly ports: BalancePorts) {
    super();
  }
  protected idle(): BalanceState {
    return BALANCE_IDLE;
  }
  async load(bookingId: string): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    this.update({ phase: 'loading', balance: null });
    try {
      const balance = await this.ports.balance(bookingId);
      if (stamp !== this.epoch) return;
      this.update(
        balance.bookingId === bookingId
          ? { phase: 'ready', balance }
          : { phase: 'error', balance: null },
      );
    } catch (error) {
      if (stamp === this.epoch) this.update({ phase: readFailure(error), balance: null });
    }
  }
}
