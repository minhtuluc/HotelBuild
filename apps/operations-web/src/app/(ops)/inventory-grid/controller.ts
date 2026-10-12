import { isApiError } from '@pinehill/api-client';
import type { InventoryGridCell } from './model';
import { gridDates, type GridRange } from '../../../lib/inventory-grid';
export interface GridData {
  propertyId: string;
  range: GridRange;
  properties: readonly { id: string; name: string }[];
  rows: readonly { roomTypeId: string; code: string; cells: readonly InventoryGridCell[] }[];
  capturedAt: string | null;
}
export interface GridState {
  phase: 'loading' | 'ready' | 'empty' | 'error' | 'validation' | 'forbidden' | 'expired';
  data: GridData | null;
  properties: GridData['properties'];
  propertyId: string;
  range: GridRange;
  error: unknown;
  busy: boolean;
}
export type GridPort = (
  propertyId: string,
  range: GridRange,
  signal: AbortSignal,
) => Promise<GridData>;
export class GridController {
  state: GridState;
  private alive = true;
  private denied = false;
  private epoch = 0;
  private abort = new AbortController();
  private listeners = new Set<() => void>();
  constructor(
    private readonly port: GridPort,
    range: GridRange,
  ) {
    this.state = {
      phase: 'loading',
      data: null,
      properties: [],
      propertyId: '',
      range,
      error: null,
      busy: false,
    };
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private update(patch: Partial<GridState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private current(stamp: number): boolean {
    return this.alive && !this.denied && stamp === this.epoch;
  }
  deny(phase: 'forbidden' | 'expired' = 'forbidden'): void {
    if (!this.alive) return;
    this.denied = true;
    this.epoch++;
    this.abort.abort();
    this.update({ phase, data: null, properties: [], error: null, busy: false });
  }
  invalidate(): void {
    if (!this.alive || this.denied) return;
    this.epoch++;
    this.abort.abort();
    this.update({ data: null, properties: [], error: null, phase: 'loading', busy: false });
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  private failure(error: unknown, stamp: number): void {
    if (!this.alive) return;
    if (isApiError(error) && (error.status === 401 || error.status === 403)) {
      this.deny(error.status === 401 ? 'expired' : 'forbidden');
      return;
    }
    if (this.current(stamp)) this.update({ phase: 'error', error, busy: false });
  }
  private prepare(propertyId: string, range: GridRange): boolean {
    const changed =
      this.state.propertyId !== propertyId ||
      this.state.range.from !== range.from ||
      this.state.range.to !== range.to;
    this.update({
      propertyId,
      range,
      error: null,
      busy: false,
      ...(changed ? { data: null } : {}),
    });
    if (!gridDates(range.from, range.to).length) {
      this.update({ phase: 'validation' });
      return false;
    }
    return true;
  }
  async load(propertyId: string, range: GridRange): Promise<void> {
    if (!this.alive || this.denied) return;
    const stamp = ++this.epoch;
    this.abort.abort();
    this.abort = new AbortController();
    if (!this.prepare(propertyId, range)) return;
    this.update({ busy: true, phase: 'loading' });
    try {
      const data = await this.port(propertyId, range, this.abort.signal);
      if (!this.current(stamp)) return;
      this.update({
        data,
        properties: data.properties,
        propertyId: data.propertyId,
        range: data.range,
        busy: false,
        phase: data.rows.length ? 'ready' : 'empty',
      });
    } catch (error) {
      this.failure(error, stamp);
    }
  }
}
