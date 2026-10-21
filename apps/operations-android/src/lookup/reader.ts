/**
 * SCR-62 — nạp kết quả tra cứu từ hai tuyến đọc hiện có, chống ghi đè bởi phản hồi cũ (§8.1).
 * Lớp thuần: nhận `LookupPorts` để test không cần mạng; UI không tự quyết định trạng thái.
 */
import { isApiError } from '@pinehill/api-client';
import type { BookingSummary, GuestSummary, ListPage, UserMe } from '@pinehill/contracts';
import { OfflineError } from '../netinfo';
import { parseLookupQuery, searchPlan, type LookupQuery } from './query';
import {
  buildRows,
  guestIndex,
  lookupAccess,
  toBookingView,
  toGuestView,
  type LookupAccess,
  type LookupRow,
} from './view';

export const LOOKUP_PAGE_SIZE = 20;

export interface LookupPorts {
  actor(): Promise<UserMe>;
  guests(query: { q: string; limit: number; propertyId?: string }): Promise<ListPage<GuestSummary>>;
  bookings(query: {
    q: string;
    limit: number;
    propertyId?: string;
  }): Promise<ListPage<BookingSummary>>;
}

export type LookupPhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'invalid'
  | 'offline'
  | 'expired'
  | 'forbidden'
  | 'error';

export interface LookupState {
  readonly phase: LookupPhase;
  readonly rows: readonly LookupRow[];
  readonly query: LookupQuery | null;
  /** Máy chủ còn trang sau — hiện gợi ý thu hẹp từ khoá, không tự tải vô hạn. */
  readonly truncated: boolean;
}

const IDLE: LookupState = { phase: 'idle', rows: [], query: null, truncated: false };

function failure(error: unknown): LookupPhase {
  if (error instanceof OfflineError) return 'offline';
  if (!isApiError(error)) return 'error';
  if (error.kind === 'network' || error.kind === 'aborted') return 'offline';
  if (error.status === 401) return 'expired';
  if (error.status === 403) return 'forbidden';
  return 'error';
}

function preflight(query: LookupQuery): LookupState | null {
  if (query.kind === 'empty') return { ...IDLE, query };
  if (query.kind === 'invalid') return { ...IDLE, phase: 'invalid', query };
  return null;
}

function resultState(
  query: LookupQuery,
  access: Exclude<LookupAccess, 'denied'>,
  guestPage: ListPage<GuestSummary> | null,
  bookingPage: ListPage<BookingSummary> | null,
): LookupState {
  const guests = (guestPage?.data ?? []).map((guest) => toGuestView(guest, access));
  const index = guestIndex(guests);
  const bookings = (bookingPage?.data ?? []).map((booking) => toBookingView(booking, index));
  const rows = buildRows(guests, bookings);
  return {
    phase: rows.length === 0 ? 'empty' : 'ready',
    rows,
    query,
    truncated: guestPage?.meta.hasMore === true || bookingPage?.meta.hasMore === true,
  };
}

export class LookupReader {
  state: LookupState = IDLE;
  private epoch = 0;
  private alive = true;
  private listeners = new Set<() => void>();
  constructor(private readonly ports: LookupPorts) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(next: LookupState): void {
    if (!this.alive) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  private current(stamp: number): boolean {
    return this.alive && this.epoch === stamp;
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
  async load(raw: string, propertyId?: string): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    const query = parseLookupQuery(raw);
    const stopped = preflight(query);
    if (stopped !== null) {
      this.update(stopped);
      return;
    }
    this.update({ phase: 'loading', rows: [], query, truncated: false });
    try {
      await this.fetch(stamp, query, propertyId);
    } catch (error) {
      if (this.current(stamp))
        this.update({ phase: failure(error), rows: [], query, truncated: false });
    }
  }
  private async fetch(
    stamp: number,
    query: LookupQuery,
    propertyId: string | undefined,
  ): Promise<void> {
    const actor = await this.ports.actor();
    if (!this.current(stamp)) return;
    const access = lookupAccess(actor.role);
    if (access === 'denied') {
      this.update({ phase: 'forbidden', rows: [], query, truncated: false });
      return;
    }
    const plan = searchPlan(query);
    const term = (q: string) =>
      propertyId === undefined
        ? { q, limit: LOOKUP_PAGE_SIZE }
        : { q, limit: LOOKUP_PAGE_SIZE, propertyId };
    const [guestPage, bookingPage] = await Promise.all([
      plan.guests === null ? null : this.ports.guests(term(plan.guests)),
      plan.bookings === null ? null : this.ports.bookings(term(plan.bookings)),
    ]);
    if (!this.current(stamp)) return;
    this.update(resultState(query, access, guestPage, bookingPage));
  }
}
