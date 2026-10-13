import { isApiError } from '@pinehill/api-client';
import { applyReceipt, assertAcknowledgedProjection } from './projection';
import type { PropertySummary, RoomTypeSummary, RoomSummary, UserMe } from '@pinehill/contracts';
import {
  parseCommand,
  readAdminIntent,
  intentStorageKey,
  replayBeforeExpiry,
  type AdminScope,
  type AdminCommand,
  type AdminIntent,
} from './intent';
export interface AdminData {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  rooms?: readonly RoomSummary[];
}
export type AdminReceipt =
  | { kind: 'property-update'; data: PropertySummary }
  | { kind: 'room-type-create'; data: RoomTypeSummary }
  | { kind: 'connecting-update'; data: RoomSummary };
export interface AdminPorts {
  actor(
    signal: AbortSignal,
  ): Promise<Pick<UserMe, 'userId' | 'role'> & { propertyScope?: readonly string[] }>;
  read(signal: AbortSignal): Promise<AdminData>;
  write(command: AdminCommand, id: string, signal: AbortSignal): Promise<AdminReceipt>;
}
interface Options {
  ports: AdminPorts;
  scope: AdminScope;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  createId: () => string;
  now: () => number;
}
export interface AdminState {
  phase:
    'loading' | 'ready' | 'error' | 'validation' | 'conflict' | 'unknown' | 'forbidden' | 'expired';
  data: AdminData | null;
  canWrite: boolean;
  actorVerified: boolean;
  busy: boolean;
  error: unknown;
  receipt: AdminReceipt | null;
  referenceId: string | null;
  canCompare: boolean;
  issues: readonly { field: string; issue: string }[];
}
function denial(error: unknown): 'expired' | 'forbidden' | null {
  if (!isApiError(error)) return null;
  if (error.status === 401) return 'expired';
  return error.status === 403 ? 'forbidden' : null;
}
function conflict(error: unknown): boolean {
  return isApiError(error) && (error.status === 412 || error.status === 428);
}
function validation(error: unknown): boolean {
  return isApiError(error) && (error.status === 400 || error.status === 422);
}
function writeAffordance(role: UserMe['role'], scope: AdminScope): boolean {
  return role === 'OWNER' || (scope === 'connecting' && role === 'MANAGER');
}
export class AdminController {
  state: AdminState = {
    phase: 'loading',
    data: null,
    canWrite: false,
    actorVerified: false,
    busy: false,
    error: null,
    receipt: null,
    referenceId: null,
    canCompare: false,
    issues: [],
  };
  private alive = true;
  private denied = false;
  private epoch = 0;
  private abort = new AbortController();
  private ownerId: string | undefined;
  private context: string | undefined;
  private intent: AdminIntent | undefined;
  private corrupt = false;
  private comparison = false;
  private retryAt = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) {}
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private update(patch: Partial<AdminState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private current(stamp: number): boolean {
    return this.alive && !this.denied && stamp === this.epoch;
  }
  deny(phase: 'expired' | 'forbidden' = 'forbidden'): void {
    if (!this.alive) return;
    this.denied = true;
    this.epoch++;
    this.abort.abort();
    this.update({
      phase,
      data: null,
      canWrite: false,
      actorVerified: false,
      busy: false,
      error: null,
      receipt: null,
      referenceId: null,
      canCompare: false,
      issues: [],
    });
  }
  invalidate(): void {
    if (!this.alive || this.denied) return;
    this.epoch++;
    this.abort.abort();
    this.update({
      phase: 'loading',
      data: null,
      canWrite: false,
      actorVerified: false,
      busy: false,
      error: null,
      receipt: null,
      canCompare: false,
    });
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  private async actor(stamp: number, writing = false): Promise<boolean> {
    const actor = await this.options.ports.actor(this.abort.signal);
    if (!this.current(stamp)) return false;
    if (this.ownerId !== undefined && actor.userId !== this.ownerId) {
      this.deny();
      return false;
    }
    const context = JSON.stringify([actor.role, [...(actor.propertyScope ?? [])].sort()]);
    if (this.context !== undefined && this.context !== context)
      this.update({ data: null, receipt: null });
    this.context = context;
    this.ownerId = actor.userId;
    const canWrite = writeAffordance(actor.role, this.options.scope);
    this.update({ canWrite, actorVerified: true });
    if (writing && !canWrite) {
      this.deny();
      return false;
    }
    return true;
  }
  private restore(): void {
    if (!this.ownerId) return;
    const raw = this.options.storage.getItem(intentStorageKey(this.ownerId, this.options.scope));
    if (raw === null) {
      this.intent = undefined;
      this.corrupt = false;
      return;
    }
    try {
      this.intent = readAdminIntent(raw, this.ownerId, this.options.scope);
      this.corrupt = false;
    } catch {
      this.corrupt = true;
    }
  }
  private forget(): void {
    if (this.ownerId)
      this.options.storage.removeItem(intentStorageKey(this.ownerId, this.options.scope));
    this.intent = undefined;
    this.corrupt = false;
  }
  private readPhase(): AdminState['phase'] {
    if (this.intent || this.corrupt) return 'unknown';
    return this.comparison ? 'conflict' : 'ready';
  }
  async load(): Promise<void> {
    if (!this.alive || this.denied || this.state.busy) return;
    const stamp = ++this.epoch;
    this.abort.abort();
    this.abort = new AbortController();
    this.update({ busy: true, error: null, canCompare: false });
    try {
      if (!(await this.actor(stamp))) return;
      const data = await this.options.ports.read(this.abort.signal);
      if (!this.current(stamp)) return;
      assertAcknowledgedProjection(data, this.state.receipt);
      this.restore();
      this.update({
        data,
        phase: this.readPhase(),
        busy: false,
        referenceId: this.intent?.key ?? null,
        canCompare: this.comparison,
      });
    } catch (error) {
      this.failure(error, stamp, false);
    }
  }
  canStart(): boolean {
    return (
      this.alive &&
      !this.denied &&
      this.state.canWrite &&
      !this.state.busy &&
      !this.intent &&
      !this.corrupt &&
      !this.comparison
    );
  }
  canRetry(): boolean {
    return (
      !!this.intent &&
      !this.corrupt &&
      this.state.canWrite &&
      replayBeforeExpiry(this.intent, this.options.now()) &&
      this.options.now() >= this.retryAt
    );
  }
  validation(issues: AdminState['issues']): void {
    if (!this.canStart()) return;
    this.update({ phase: 'validation', issues, error: null });
  }
  clearValidation(): void {
    if (!this.intent && !this.corrupt && !this.comparison && !this.state.busy)
      this.update({ phase: 'ready', issues: [], error: null });
  }
  adoptVersion(): void {
    if (this.state.phase !== 'conflict' || !this.state.canCompare || this.state.busy) return;
    this.comparison = false;
    this.update({ phase: 'ready', canCompare: false, error: null, issues: [] });
  }
  async save(command: AdminCommand): Promise<void> {
    if (!this.canStart()) return;
    const stamp = ++this.epoch;
    this.update({ busy: true, error: null, issues: [], receipt: null });
    try {
      if (!(await this.actor(stamp, true))) return;
      this.restore();
      if (this.intent || this.corrupt) {
        this.update({ phase: 'unknown', busy: false, referenceId: this.intent?.key ?? null });
        return;
      }
      const ownerId = this.ownerId;
      if (!ownerId) return;
      const intent = {
        ownerId,
        key: this.options.createId(),
        createdAt: this.options.now(),
        command: parseCommand(command, this.options.scope),
      };
      this.options.storage.setItem(
        intentStorageKey(ownerId, this.options.scope),
        JSON.stringify(intent),
      );
      this.intent = intent;
      await this.send(intent, stamp);
    } catch (error) {
      this.failure(error, stamp, false);
    }
  }
  private failure(error: unknown, stamp: number, sent: boolean): void {
    if (!this.current(stamp)) return;
    const phase = denial(error);
    if (phase) {
      this.deny(phase);
      return;
    }
    this.update({
      phase: sent ? 'unknown' : 'error',
      error,
      busy: false,
      canCompare: false,
      referenceId: this.intent?.key ?? null,
    });
  }
  private writeFailure(error: unknown, stamp: number): void {
    if (!this.current(stamp)) return;
    if (conflict(error) || validation(error)) {
      try {
        this.forget();
      } catch (storageError) {
        this.failure(storageError, stamp, true);
        return;
      }
      this.comparison = conflict(error);
      this.update({
        phase: this.comparison ? 'conflict' : 'validation',
        error,
        busy: false,
        canCompare: false,
        referenceId: null,
        issues: isApiError(error)
          ? (error.details ?? [{ field: '(biểu mẫu)', issue: error.code ?? 'INVALID' }])
          : [],
      });
      return;
    }
    this.setRetryDelay(error);
    this.failure(error, stamp, true);
  }
  private setRetryDelay(error: unknown): void {
    if (isApiError(error) && error.retryAfterSeconds !== undefined)
      this.retryAt = this.options.now() + error.retryAfterSeconds * 1000;
  }
  private async send(intent: AdminIntent, stamp: number): Promise<void> {
    let receipt: AdminReceipt;
    try {
      if (!this.current(stamp)) return;
      receipt = await this.options.ports.write(intent.command, intent.key, this.abort.signal);
    } catch (error) {
      this.writeFailure(error, stamp);
      return;
    }
    if (!this.current(stamp)) return;
    this.update({
      receipt,
      data: applyReceipt(this.state.data, receipt),
      busy: false,
      referenceId: null,
      issues: [],
      phase: 'ready',
    });
    try {
      this.forget();
    } catch (error) {
      this.update({ phase: 'error', error });
      return;
    }
    await this.load();
  }
  async retry(): Promise<void> {
    const intent = this.intent;
    if (!intent || !this.canRetry() || this.state.busy || !this.alive || this.denied) return;
    const stamp = ++this.epoch;
    this.update({ busy: true, error: null });
    try {
      if (await this.actor(stamp, true)) await this.send(intent, stamp);
    } catch (error) {
      this.failure(error, stamp, false);
    }
  }
}
