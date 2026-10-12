import { isApiError } from '@pinehill/api-client';
import type { AuditLogEntry, ListPage } from '@pinehill/contracts';
import {
  AUDIT_PAGE_SIZE,
  EMPTY_AUDIT_FILTERS,
  buildAuditQuery,
  mergeAuditRows,
  type AuditFilters,
  type AuditPageQuery,
} from '../../../lib/audit-log';
export type AuditPort = (
  query: AuditPageQuery,
  signal: AbortSignal,
) => Promise<ListPage<AuditLogEntry>>;
export interface AuditState {
  phase:
    'loading' | 'refreshing' | 'ready' | 'empty' | 'error' | 'forbidden' | 'expired' | 'validation';
  rows: readonly AuditLogEntry[];
  nextCursor: string | null;
  filters: AuditFilters;
  error: unknown;
  loadingMore: boolean;
  updatedAt: string | null;
}
function denial(error: unknown): 'expired' | 'forbidden' | null {
  if (!isApiError(error)) return null;
  if (error.status === 401) return 'expired';
  return error.status === 403 ? 'forbidden' : null;
}
function equalFilters(a: AuditFilters, b: AuditFilters): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Owns current read generation and all exportable data; terminal denial cannot resurrect rows. */
export class AuditController {
  state: AuditState = {
    phase: 'loading',
    rows: [],
    nextCursor: null,
    filters: { ...EMPTY_AUDIT_FILTERS },
    error: null,
    loadingMore: false,
    updatedAt: null,
  };
  private epoch = 0;
  private alive = true;
  private denied = false;
  private abort = new AbortController();
  private listeners = new Set<() => void>();
  constructor(
    private readonly read: AuditPort,
    private readonly now: () => number = Date.now,
  ) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private update(patch: Partial<AuditState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  deny(phase: 'expired' | 'forbidden' = 'forbidden'): void {
    this.denied = true;
    this.epoch++;
    this.abort.abort();
    this.update({
      phase,
      rows: [],
      nextCursor: null,
      error: null,
      loadingMore: false,
      updatedAt: null,
    });
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  private current(stamp: number): boolean {
    return this.alive && !this.denied && stamp === this.epoch;
  }
  private failure(error: unknown, stamp: number): void {
    if (!this.alive) return;
    const phase = denial(error);
    if (phase) {
      this.deny(phase);
      return;
    }
    if (this.current(stamp)) this.update({ phase: 'error', error, loadingMore: false });
  }
  async load(filters: AuditFilters): Promise<void> {
    if (!this.alive || this.denied) return;
    let query: AuditPageQuery;
    try {
      query = buildAuditQuery(filters);
    } catch (error) {
      this.update({ phase: 'validation', error });
      return;
    }
    const same = equalFilters(filters, this.state.filters);
    const stamp = ++this.epoch;
    this.abort.abort();
    this.abort = new AbortController();
    this.update({
      filters: { ...filters },
      phase: same && this.state.rows.length ? 'refreshing' : 'loading',
      error: null,
      loadingMore: false,
      ...(same ? {} : { rows: [], nextCursor: null, updatedAt: null }),
    });
    try {
      const page = await this.read(query, this.abort.signal);
      if (!this.current(stamp)) return;
      this.update({
        rows: page.data,
        nextCursor: page.meta.nextCursor,
        phase: page.data.length ? 'ready' : 'empty',
        updatedAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      this.failure(error, stamp);
    }
  }
  async loadMore(): Promise<void> {
    if (!this.alive || this.denied || this.state.loadingMore || !this.state.nextCursor) return;
    const stamp = this.epoch;
    const query = buildAuditQuery(this.state.filters, AUDIT_PAGE_SIZE, this.state.nextCursor);
    this.update({ loadingMore: true, error: null });
    try {
      const page = await this.read(query, this.abort.signal);
      if (!this.current(stamp)) return;
      this.update({
        rows: mergeAuditRows(this.state.rows, page.data),
        nextCursor: page.meta.nextCursor,
        phase: 'ready',
        updatedAt: new Date(this.now()).toISOString(),
      });
    } catch (error) {
      this.failure(error, stamp);
    } finally {
      if (this.current(stamp)) this.update({ loadingMore: false });
    }
  }
}
