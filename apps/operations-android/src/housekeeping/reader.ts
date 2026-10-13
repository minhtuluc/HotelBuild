import { isApiError } from '@pinehill/api-client';
import type {
  UserMe,
  HousekeepingTask,
  HousekeepingTaskQuery,
  ListPage,
} from '@pinehill/contracts';
import { OfflineError } from '../netinfo';
export interface TaskPorts {
  actor(signal: AbortSignal): Promise<UserMe>;
  read(query: HousekeepingTaskQuery, signal: AbortSignal): Promise<ListPage<HousekeepingTask>>;
}
export interface TaskState {
  phase:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'empty'
    | 'validation'
    | 'offline'
    | 'expired'
    | 'forbidden'
    | 'error';
  tasks: readonly HousekeepingTask[];
}
export function validTaskDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000-')) return false;
  const instant = new Date(date + 'T00:00:00Z');
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === date;
}
export function todayVN(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}
function signature(actor: UserMe): string {
  return JSON.stringify([actor.userId, actor.role, [...actor.propertyScope].sort()]);
}
function failure(error: unknown): TaskState['phase'] {
  if (error instanceof OfflineError) return 'offline';
  if (isApiError(error)) {
    if (error.status === 401) return 'expired';
    if (error.status === 403) return 'forbidden';
  }
  return 'error';
}
function verifyTasks(rows: readonly HousekeepingTask[], query: HousekeepingTaskQuery): void {
  if (
    rows.some(
      (row) =>
        row.assignedTo !== query.assignedTo ||
        row.businessDate !== query.businessDate ||
        !Number.isSafeInteger(row.version),
    )
  )
    throw Error('Invalid task projection');
}
export class TaskReader {
  state: TaskState = { phase: 'idle', tasks: [] };
  private epoch = 0;
  private alive = true;
  private ownerId: string | undefined;
  private abort = new AbortController();
  private listeners = new Set<() => void>();
  constructor(private readonly ports: TaskPorts) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(phase: TaskState['phase'], tasks: readonly HousekeepingTask[] = []): void {
    if (!this.alive) return;
    this.state = { phase, tasks };
    for (const listener of this.listeners) listener();
  }
  private current(stamp: number): boolean {
    return this.alive && this.epoch === stamp;
  }
  invalidate(): void {
    this.epoch++;
    this.abort.abort();
    this.update('idle');
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  async load(date: string, propertyId?: string): Promise<void> {
    if (!this.alive) return;
    const stamp = ++this.epoch;
    this.abort.abort();
    this.abort = new AbortController();
    this.update('loading');
    if (!validTaskDate(date)) {
      this.update('validation');
      return;
    }
    try {
      const actor = await this.ports.actor(this.abort.signal);
      if (!this.current(stamp)) return;
      if (this.ownerId && this.ownerId !== actor.userId) {
        this.update('expired');
        return;
      }
      this.ownerId = actor.userId;
      const query = {
        businessDate: date,
        assignedTo: actor.userId,
        limit: 100,
        ...(propertyId ? { propertyId } : {}),
      };
      const tasks = await this.complete(query, this.abort.signal);
      if (!this.current(stamp)) return;
      await this.publish(stamp, actor, tasks);
    } catch (error) {
      if (this.current(stamp)) this.update(failure(error));
    }
  }
  private async publish(stamp: number, actor: UserMe, tasks: HousekeepingTask[]): Promise<void> {
    const fresh = await this.ports.actor(this.abort.signal);
    if (!this.current(stamp)) return;
    if (signature(actor) !== signature(fresh)) throw Error('Actor context changed');
    this.update(tasks.length ? 'ready' : 'empty', tasks);
  }
  private async complete(
    query: HousekeepingTaskQuery,
    signal: AbortSignal,
  ): Promise<HousekeepingTask[]> {
    const tasks: HousekeepingTask[] = [],
      ids = new Set<string>(),
      cursors = new Set<string>();
    let cursor: string | undefined, total: number | undefined;
    for (;;) {
      const page = await this.ports.read({ ...query, ...(cursor ? { cursor } : {}) }, signal);
      verifyTasks(page.data, query);
      verifyTotal(total, page.meta.total);
      total = page.meta.total;
      appendTasks(tasks, ids, page.data);
      if (!page.meta.hasMore) {
        if (tasks.length !== total) throw Error('Incomplete tasks');
        return tasks;
      }
      cursor = advanceCursor(page, cursors);
    }
  }
}

function verifyTotal(prior: number | undefined, current: number): void {
  if (prior !== undefined && prior !== current) throw Error('Task catalogue changed');
}
function appendTasks(
  target: HousekeepingTask[],
  ids: Set<string>,
  source: readonly HousekeepingTask[],
): void {
  for (const task of source) {
    if (ids.has(task.id)) throw Error('Repeated task');
    ids.add(task.id);
    target.push(task);
  }
}
function advanceCursor(page: ListPage<HousekeepingTask>, cursors: Set<string>): string {
  const cursor = page.meta.nextCursor;
  if (!cursor || cursors.has(cursor) || !page.data.length) throw Error('Invalid task cursor');
  cursors.add(cursor);
  return cursor;
}
