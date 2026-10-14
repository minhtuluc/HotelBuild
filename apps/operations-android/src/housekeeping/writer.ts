import {
  context,
  rejection,
  verifyAck,
  newIntent,
  bindingCollision,
  ContextChanged,
  InvalidTask,
} from './write-validation';
import type { ApiResponse } from '@pinehill/api-client';
import type { HousekeepingTask, UserMe } from '@pinehill/contracts';
import type { KeyValueStorage } from '../storage';
import { validTaskDate } from './reader';
import {
  claimPending,
  clearPending,
  markForReview,
  parseIntent,
  readPending,
  withinReplayWindow,
  PendingTaskIntent,
  type TaskIntent,
  type TaskTarget,
} from './intent';
export interface TaskWritePorts {
  watch(listener: () => void): () => void;
  actor(signal: AbortSignal): Promise<UserMe>;
  property(): string | null;
  write(intent: TaskIntent, signal: AbortSignal): Promise<ApiResponse<HousekeepingTask>>;
}
export interface TaskWriteDeps extends TaskWritePorts {
  storage: KeyValueStorage;
  createId(): string;
  now(): number;
}
export type TaskWritePhase =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'sending'
  | 'saved'
  | 'unknown'
  | 'needsReview'
  | 'storageError'
  | 'validation'
  | 'conflict'
  | 'rejected'
  | 'expired'
  | 'forbidden'
  | 'error';
export class TaskWriter {
  state: { phase: TaskWritePhase } = { phase: 'idle' };
  private alive = true;
  private epoch = 0;
  private abort = new AbortController();
  private initialized = false;
  private owner: string | undefined;
  private identity: string | undefined;
  private intent: TaskIntent | undefined;
  private listeners = new Set<() => void>();
  private readonly unwatch: () => void;
  constructor(private readonly deps: TaskWriteDeps) {
    this.unwatch = deps.watch(() => this.invalidate());
  }
  get busy(): boolean {
    return this.state.phase === 'checking' || this.state.phase === 'sending';
  }
  get canStart(): boolean {
    return this.alive && this.initialized && !this.busy && !this.intent;
  }
  get canRetry(): boolean {
    return (
      this.alive &&
      this.intent !== undefined &&
      ['unknown', 'storageError'].includes(this.state.phase)
    );
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(phase: TaskWritePhase): void {
    if (!this.alive) return;
    this.state = { phase };
    for (const listener of this.listeners) listener();
  }
  private current(stamp: number): boolean {
    return this.alive && this.epoch === stamp;
  }
  private begin(): number {
    this.epoch++;
    this.abort.abort();
    this.abort = new AbortController();
    this.update('checking');
    return this.epoch;
  }
  invalidate(): void {
    this.epoch++;
    this.abort.abort();
    this.initialized = false;
    this.identity = undefined;
    this.intent = undefined;
    this.update('idle');
  }
  dispose(): void {
    this.unwatch();
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  private async actor(stamp: number): Promise<UserMe | undefined> {
    const actor = await this.deps.actor(this.abort.signal);
    if (!this.current(stamp)) return;
    const identity = context(actor, this.deps.property());
    if (this.owner !== undefined && actor.userId !== this.owner) throw new ContextChanged();
    if (this.identity !== undefined && identity !== this.identity) throw new ContextChanged();
    this.owner = actor.userId;
    this.identity = identity;
    return actor;
  }
  async restore(): Promise<void> {
    if (!this.alive || this.busy) return;
    const stamp = this.begin();
    this.initialized = false;
    this.intent = undefined;
    try {
      const actor = await this.actor(stamp);
      if (!actor) return;
      const raw = await readPending(this.deps.storage, actor.userId);
      if (!this.current(stamp)) return;
      this.recover(raw, actor);
    } catch (error) {
      if (this.current(stamp)) this.preflightFailure(error);
    }
  }
  private recover(raw: string | null, actor: UserMe): void {
    if (raw === null) {
      this.initialized = true;
      this.update('ready');
      return;
    }
    const intent = parseIntent(raw);
    if (!intent || !validTaskDate(intent.businessDate)) {
      this.update('needsReview');
      return;
    }
    if (intent.owner !== actor.userId || intent.context !== this.identity)
      throw new ContextChanged();
    this.intent = intent;
    this.initialized = true;
    this.update(
      !intent.review && withinReplayWindow(intent, this.deps.now()) ? 'unknown' : 'needsReview',
    );
  }
  private preflightFailure(error: unknown): void {
    this.initialized = false;
    this.update(error instanceof ContextChanged ? 'forbidden' : (rejection(error) ?? 'error'));
  }
  async start(task: HousekeepingTask, target: TaskTarget): Promise<void> {
    if (!this.canStart) return;
    const stamp = this.begin();
    try {
      const actor = await this.actor(stamp);
      if (!actor) return;
      this.intent = newIntent(task, target, actor, this.identity!, this.deps);
      await this.persistAndSend(stamp, true);
    } catch (error) {
      if (!this.current(stamp)) return;
      if (error instanceof InvalidTask) this.update('validation');
      else this.preflightFailure(error);
    }
  }
  async retry(): Promise<void> {
    if (!this.canRetry || !this.intent) return;
    if (!withinReplayWindow(this.intent, this.deps.now())) {
      this.update('needsReview');
      return;
    }
    const stamp = this.begin();
    try {
      if (!(await this.actor(stamp))) return;
      await this.persistAndSend(stamp, false);
    } catch (error) {
      if (this.current(stamp)) this.preflightFailure(error);
    }
  }
  private async persistAndSend(stamp: number, first: boolean): Promise<void> {
    const intent = this.intent;
    if (!intent) return;
    try {
      await claimPending(this.deps.storage, intent);
    } catch (error) {
      if (!this.current(stamp)) return;
      if (error instanceof PendingTaskIntent) {
        this.initialized = false;
        this.intent = undefined;
        this.update('needsReview');
      } else this.update('storageError');
      return;
    }
    if (!this.current(stamp)) return;
    if (!withinReplayWindow(intent, this.deps.now())) {
      this.update('needsReview');
      return;
    }
    await this.send(stamp, intent, first);
  }
  private async send(stamp: number, intent: TaskIntent, first: boolean): Promise<void> {
    this.update('sending');
    let ackSeen = false;
    if (!this.current(stamp)) return;
    try {
      const result = await this.deps.write(intent, this.abort.signal);
      ackSeen = true;
      if (!this.current(stamp)) return;
      verifyAck(result, intent);
      if (!(await this.actor(stamp))) return;
      await clearPending(this.deps.storage, intent);
      if (!this.current(stamp)) return;
      this.intent = undefined;
      this.update('saved');
    } catch (error) {
      await this.sendFailure(stamp, intent, first, ackSeen, error);
    }
  }
  private async sendFailure(
    stamp: number,
    intent: TaskIntent,
    first: boolean,
    ackSeen: boolean,
    error: unknown,
  ): Promise<void> {
    if (!this.current(stamp)) return;
    if (bindingCollision(error)) {
      await this.review(stamp, intent);
      return;
    }
    const rejected = rejection(error);
    if (!ackSeen && first && rejected) {
      await this.rejected(stamp, intent, rejected);
      return;
    }
    if (rejected) await this.review(stamp, intent);
    else this.update('unknown');
  }
  private async review(stamp: number, intent: TaskIntent): Promise<void> {
    this.update('needsReview');
    try {
      const blocked = await markForReview(this.deps.storage, intent);
      if (this.current(stamp)) this.intent = blocked;
    } catch {
      // Retain the original durable request; failure cannot enable mutation in this controller.
      if (this.current(stamp)) {
        this.initialized = false;
        this.update('needsReview');
      }
    }
  }

  private async rejected(stamp: number, intent: TaskIntent, phase: TaskWritePhase): Promise<void> {
    try {
      await clearPending(this.deps.storage, intent);
      if (!this.current(stamp)) return;
      this.intent = undefined;
      this.initialized = !['expired', 'forbidden'].includes(phase);
      this.update(phase);
    } catch {
      if (this.current(stamp)) this.update('unknown');
    }
  }
}
