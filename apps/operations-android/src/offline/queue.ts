import { QueueFailure, type QueueDeps, type QueueEntry } from './types';
import { QueueRepository } from './repository';
import { parseAction, parseContext, parseEntry, uuid } from './validation';
import { deliver, inReplayWindow } from './delivery';

export class OfflineQueue {
  private readonly repository: QueueRepository;
  private entries: QueueEntry[] = [];
  private alive = true;
  private readonly abort = new AbortController();
  private unwatch = () => {};
  constructor(private readonly deps: QueueDeps) {
    this.repository = new QueueRepository(deps.storage, parseContext(deps.context));
    this.unwatch = deps.watch?.(() => this.dispose()) ?? (() => {});
  }
  snapshot(): readonly QueueEntry[] {
    return this.entries.map(parseEntry);
  }
  private active(): void {
    if (!this.alive) throw new QueueFailure('CONTEXT_CHANGED');
  }
  private async change(work: (entries: QueueEntry[]) => QueueEntry[]): Promise<void> {
    this.active();
    await this.repository.transaction(async (tx) => {
      this.active();
      await tx.save(work(tx.entries));
      this.active();
      this.entries = tx.entries;
    });
  }
  async restore(): Promise<void> {
    this.active();
    try {
      await this.repository.transaction(async (tx) => {
        this.active();
        if (
          tx.entries.some(
            (entry) => entry.phase === 'SENDING' || (entry.phase === 'QUEUED' && entry.attempted),
          )
        )
          await tx.save(
            tx.entries.map((entry) =>
              entry.phase === 'SENDING' || (entry.phase === 'QUEUED' && entry.attempted)
                ? { ...entry, phase: 'NEEDS_REVIEW', reason: 'UNKNOWN_RESULT' }
                : entry,
            ),
          );
        this.active();
        this.entries = tx.entries;
      });
    } catch (error) {
      this.entries = [];
      throw error;
    }
  }
  async draft(input: unknown): Promise<QueueEntry> {
    const action = parseAction(input);
    const key = this.deps.createId(),
      createdAt = this.deps.now();
    if (!uuid(key) || key[14] !== '4' || !Number.isSafeInteger(createdAt) || createdAt < 0)
      throw new QueueFailure('INVALID_ACTION');
    const entry: QueueEntry = {
      key,
      context: parseContext(this.deps.context),
      action,
      createdAt,
      phase: 'DRAFT',
      attempted: false,
      lastAttemptAt: null,
      reason: null,
    };
    await this.change((entries) => {
      if (
        action.kind === 'HOUSEKEEPING_STATUS' &&
        entries.some(
          (current) =>
            current.phase !== 'CONFIRMED' &&
            current.action.kind === 'HOUSEKEEPING_STATUS' &&
            current.action.taskId === action.taskId,
        )
      )
        throw new QueueFailure('PENDING_TASK');
      return [...entries.filter((current) => current.phase !== 'CONFIRMED'), entry];
    });
    return parseEntry(entry);
  }
  async enqueue(key: string): Promise<void> {
    await this.change((entries) => {
      if (!entries.some((entry) => entry.key === key)) throw new QueueFailure('NOT_FOUND');
      return entries.map((entry) =>
        entry.key === key && entry.phase === 'DRAFT' ? { ...entry, phase: 'QUEUED' } : entry,
      );
    });
  }
  async discard(key: string): Promise<void> {
    await this.change((entries) => {
      if (entries.some((entry) => entry.key === key && entry.attempted))
        throw new QueueFailure('ALREADY_SENT');
      return entries.filter((entry) => entry.key !== key);
    });
  }
  async sync(): Promise<void> {
    this.active();
    try {
      await this.repository.transaction(async (tx) => {
        this.active();
        for (const entry of tx.entries) {
          const expiredUnknown =
            entry.phase === 'NEEDS_REVIEW' &&
            entry.reason === 'UNKNOWN_RESULT' &&
            !inReplayWindow(entry, this.deps.now());
          if (entry.phase !== 'QUEUED' && !expiredUnknown) continue;
          await deliver(tx, entry, this.deps, this.abort.signal, (entries) => {
            if (this.alive) this.entries = entries;
          });
          this.active();
        }
      });
    } catch (error) {
      if (error instanceof QueueFailure && error.code === 'CONTEXT_CHANGED') this.dispose();
      else throw error;
    }
  }
  async retry(key: string): Promise<void> {
    await this.change((entries) => {
      if (!entries.some((entry) => entry.key === key)) throw new QueueFailure('NOT_FOUND');
      return entries.map((entry) => {
        if (entry.key !== key) return entry;
        if (
          entry.phase !== 'NEEDS_REVIEW' ||
          entry.reason !== 'UNKNOWN_RESULT' ||
          !inReplayWindow(entry, this.deps.now())
        )
          throw new QueueFailure('REVIEW_REQUIRED');
        return { ...entry, phase: 'QUEUED', reason: null };
      });
    });
  }
  dispose(): void {
    this.alive = false;
    this.abort.abort();
    this.unwatch();
    this.entries = [];
  }
}
