import { isApiError } from '@pinehill/api-client';
import { validDay, type DayData } from './model';

export interface DayApi {
  load(propertyId: string, date: string): Promise<DayData>;
}
export interface DayState {
  phase: 'loading' | 'ready' | 'error' | 'forbidden';
  data: DayData | null;
  error: unknown;
  propertyId: string;
  date: string;
  properties: DayData['properties'];
}
export class DayBoardController {
  state: DayState;
  private epoch = 0;
  private denied = false;
  private listeners = new Set<() => void>();
  constructor(
    private readonly api: DayApi,
    date: string,
  ) {
    this.state = {
      phase: 'loading',
      data: null,
      error: null,
      propertyId: '',
      date,
      properties: [],
    };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private update(patch: Partial<DayState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  selectProperty(propertyId: string): void {
    this.epoch++;
    this.update({ propertyId, data: null, error: null, phase: 'ready' });
  }
  selectDate(date: string): void {
    this.epoch++;
    this.update({ date, error: null, phase: 'ready' });
  }
  dispose(): void {
    this.epoch++;
    this.listeners.clear();
  }
  deny(): void {
    this.denied = true;
    this.epoch++;
    this.update({ phase: 'forbidden', data: null, error: null, properties: [] });
  }
  async load(): Promise<void> {
    if (this.denied) return;
    if (!validDay(this.state.date)) {
      this.update({ phase: 'error', error: new Error('Invalid selected day') });
      return;
    }
    const stamp = ++this.epoch;
    const { propertyId, date } = this.state;
    this.update({ phase: 'loading', error: null });
    try {
      const data = await this.api.load(propertyId, date);
      if (stamp !== this.epoch || this.denied) return;
      this.update({
        phase: 'ready',
        data,
        propertyId: data.propertyId,
        properties: data.properties,
      });
    } catch (error) {
      if (stamp !== this.epoch || this.denied) return;
      if (isDenied(error)) {
        this.deny();
        return;
      }
      this.update({ phase: 'error', error });
    }
  }
}

function isDenied(error: unknown): boolean {
  return isApiError(error) && [401, 403].includes(error.status ?? 0);
}
