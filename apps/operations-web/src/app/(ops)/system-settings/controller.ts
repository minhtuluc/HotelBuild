import { isApiError } from '@pinehill/api-client';
import type { SystemSetting, SystemSettingUpdateRequest, UserMe } from '@pinehill/contracts';
import {
  ifMatchOf,
  updateRequest,
  validateEdit,
  type FieldIssue,
} from '../../../lib/system-settings';
import { readIntent, replayAllowed, storageKey, type SettingIntent } from './intent';
export interface SettingsPorts {
  actor(signal: AbortSignal): Promise<Pick<UserMe, 'userId' | 'role'>>;
  list(signal: AbortSignal): Promise<SystemSetting[]>;
  write(
    key: string,
    body: SystemSettingUpdateRequest,
    tag: string,
    id: string,
    signal: AbortSignal,
  ): Promise<void>;
}
interface Options {
  ports: SettingsPorts;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  createId: () => string;
  now: () => number;
}
export interface SettingDraft {
  key: string;
  value: string;
  reason: string;
  version: number;
}
export interface SettingsState {
  phase:
    | 'loading'
    | 'ready'
    | 'empty'
    | 'error'
    | 'validation'
    | 'conflict'
    | 'unknown'
    | 'forbidden'
    | 'expired';
  rows: readonly SystemSetting[];
  draft: SettingDraft | null;
  saved: string | null;
  error: unknown;
  busy: boolean;
  issues: readonly FieldIssue[];
  referenceId: string | null;
  canCompare: boolean;
}
function denied(error: unknown): 'forbidden' | 'expired' | null {
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
/** Presentation intents only. Authoritative roles/versions/values remain on the API. */
export class SettingsController {
  state: SettingsState = {
    phase: 'loading',
    rows: [],
    draft: null,
    saved: null,
    error: null,
    busy: false,
    issues: [],
    referenceId: null,
    canCompare: false,
  };
  private alive = true;
  private denied = false;
  private epoch = 0;
  private abort = new AbortController();
  private ownerId: string | undefined;
  private intent: SettingIntent | undefined;
  private corrupt = false;
  private retryAt = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly options: Options) {}
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private update(patch: Partial<SettingsState>): void {
    if (!this.alive) return;
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  private current(stamp: number): boolean {
    return this.alive && !this.denied && stamp === this.epoch;
  }
  deny(phase: 'expired' | 'forbidden' = 'forbidden'): void {
    this.denied = true;
    this.epoch++;
    this.abort.abort();
    this.update({
      phase,
      rows: [],
      draft: null,
      saved: null,
      error: null,
      busy: false,
      issues: [],
      referenceId: null,
      canCompare: false,
    });
  }
  dispose(): void {
    this.alive = false;
    this.epoch++;
    this.abort.abort();
    this.listeners.clear();
  }
  private async checkOwner(stamp: number): Promise<boolean> {
    const actor = await this.options.ports.actor(this.abort.signal);
    if (!this.current(stamp)) return false;
    if (actor.role !== 'OWNER' || (this.ownerId !== undefined && actor.userId !== this.ownerId)) {
      this.deny();
      return false;
    }
    this.ownerId = actor.userId;
    return true;
  }
  private restore(): void {
    if (!this.ownerId) return;
    const raw = this.options.storage.getItem(storageKey(this.ownerId));
    if (raw === null) {
      this.intent = undefined;
      this.corrupt = false;
      return;
    }
    try {
      this.intent = readIntent(raw, this.ownerId);
      this.corrupt = false;
    } catch {
      this.corrupt = true;
    }
  }
  private store(intent: SettingIntent): void {
    this.options.storage.setItem(storageKey(intent.ownerId), JSON.stringify(intent));
    this.intent = intent;
  }
  private forget(): void {
    if (this.ownerId) this.options.storage.removeItem(storageKey(this.ownerId));
    this.intent = undefined;
    this.corrupt = false;
  }
  private readPhase(wasConflict: boolean): SettingsState['phase'] {
    if (this.intent || this.corrupt) return 'unknown';
    if (wasConflict) return 'conflict';
    return this.state.rows.length ? 'ready' : 'empty';
  }
  async load(): Promise<void> {
    if (!this.alive || this.denied || this.state.busy) return;
    const stamp = ++this.epoch;
    const wasConflict = this.state.phase === 'conflict';
    this.abort.abort();
    this.abort = new AbortController();
    this.update({ busy: true, error: null });
    try {
      if (!(await this.checkOwner(stamp))) return;
      const rows = await this.options.ports.list(this.abort.signal);
      if (!this.current(stamp)) return;
      this.restore();
      this.update({ rows, busy: false });
      this.update({
        phase: this.readPhase(wasConflict),
        referenceId: this.intent?.key ?? null,
        canCompare: wasConflict,
      });
    } catch (error) {
      this.readFailure(error, stamp);
    }
  }
  private readFailure(error: unknown, stamp: number): void {
    const phase = denied(error);
    if (phase) {
      this.deny(phase);
      return;
    }
    if (this.current(stamp)) this.update({ phase: 'error', error, busy: false });
  }

  edit(key: string): void {
    if (!this.alive || this.denied || this.state.busy || this.intent || this.corrupt) return;
    if (this.state.phase !== 'ready') return;
    const row = this.state.rows.find((r) => r.key === key);
    if (!row || !Number.isSafeInteger(row.version)) return;
    this.update({
      draft: { key: row.key, value: row.value, reason: '', version: row.version },
      saved: null,
      issues: [],
      error: null,
    });
  }
  draft(value: string, reason: string): void {
    if (!this.state.draft || this.state.busy || this.intent || this.corrupt) return;
    this.update({ draft: { ...this.state.draft, value, reason } });
  }
  cancel(): void {
    if (!this.intent && !this.corrupt && !this.state.busy) this.update({ draft: null, issues: [] });
  }
  acceptVersion(): void {
    if (this.state.phase !== 'conflict' || !this.state.canCompare || !this.state.draft) return;
    const row = this.state.rows.find((r) => r.key === this.state.draft?.key);
    if (!row || !Number.isSafeInteger(row.version)) return;
    this.update({
      draft: { ...this.state.draft, version: row.version },
      phase: 'ready',
      canCompare: false,
      issues: [],
      error: null,
    });
  }
  private prepared(): SettingDraft | null {
    if (
      !this.alive ||
      this.denied ||
      this.state.busy ||
      this.intent ||
      this.corrupt ||
      this.state.phase === 'conflict'
    )
      return null;
    return this.state.draft;
  }
  async save(): Promise<void> {
    const draft = this.prepared();
    if (!draft) return;
    const row = this.state.rows.find((r) => r.key === draft.key);
    if (!row) return;
    const issues = validateEdit(row, draft.value, draft.reason);
    if (issues.length) {
      this.update({ phase: 'validation', issues });
      return;
    }
    const stamp = ++this.epoch;
    this.update({ busy: true, error: null });
    try {
      if (!(await this.checkOwner(stamp))) return;
      const ownerId = this.ownerId;
      if (!ownerId) return;
      if (this.restoreFence()) return;
      const intent = {
        ownerId,
        settingKey: draft.key,
        body: updateRequest(draft.value, draft.reason),
        tag: ifMatchOf(draft.version),
        key: this.options.createId(),
        createdAt: this.options.now(),
      };
      this.store(intent);
      await this.send(intent, stamp);
    } catch (error) {
      this.failure(error, stamp, false);
    }
  }
  private restoreFence(): boolean {
    this.restore();
    if (!this.intent && !this.corrupt) return false;
    this.update({ phase: 'unknown', busy: false, referenceId: this.intent?.key ?? null });
    return true;
  }
  private failure(error: unknown, stamp: number, sent: boolean): void {
    const phase = denied(error);
    if (phase) {
      this.deny(phase);
      return;
    }
    if (!this.current(stamp)) return;
    this.update({
      phase: sent ? 'unknown' : 'error',
      error,
      busy: false,
      referenceId: this.intent?.key ?? null,
    });
  }
  private definite(error: unknown): boolean {
    return conflict(error) || validation(error);
  }
  private handleWriteError(error: unknown, stamp: number): void {
    if (!this.current(stamp)) {
      return;
    }
    if (denied(error)) {
      this.failure(error, stamp, true);
      return;
    }
    if (this.definite(error)) {
      this.forget();
      this.update({
        phase: conflict(error) ? 'conflict' : 'validation',
        busy: false,
        error,
        canCompare: false,
        issues: isApiError(error)
          ? (error.details ?? [{ field: '(biểu mẫu)', issue: error.code ?? 'INVALID' }])
          : [],
      });
      return;
    }
    if (isApiError(error) && error.retryAfterSeconds !== undefined)
      this.retryAt = this.options.now() + error.retryAfterSeconds * 1000;
    this.failure(error, stamp, true);
  }
  private async send(intent: SettingIntent, stamp: number): Promise<void> {
    try {
      if (!this.current(stamp)) return;
      await this.options.ports.write(
        intent.settingKey,
        intent.body,
        intent.tag,
        intent.key,
        this.abort.signal,
      );
    } catch (error) {
      this.handleWriteError(error, stamp);
      return;
    }
    if (!this.current(stamp)) return;
    this.update({
      saved: intent.settingKey,
      draft: null,
      busy: false,
      issues: [],
      referenceId: null,
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
    if (!intent || this.state.busy || !this.alive || this.denied) return;
    if (!replayAllowed(intent, this.options.now()) || this.options.now() < this.retryAt) return;
    const stamp = ++this.epoch;
    this.update({ busy: true, error: null });
    try {
      if (await this.checkOwner(stamp)) await this.send(intent, stamp);
    } catch (error) {
      this.failure(error, stamp, false);
    }
  }
}
