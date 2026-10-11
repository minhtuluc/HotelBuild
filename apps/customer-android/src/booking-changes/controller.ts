/** HB-114: UI workflow only; money, eligibility and transitions remain server-owned. */
import { requireOnline } from '../netinfo';
import { assertPreview, samePreview, requestBody, assertResult } from './preview';
import { isApiError } from '@pinehill/api-client';
import { failurePatch } from './failure';
import type { ChangeDeps, ChangeDraft, ChangeIntent, ChangePreview, ChangeState } from './types';

export class ChangeController {
  state: ChangeState = { phase: 'editing', preview: null, result: null, notice: null };
  private draft: ChangeDraft | null = null;
  private intent: ChangeIntent | null = null;
  private retryAt = 0;
  private listeners = new Set<() => void>();
  constructor(private readonly deps: ChangeDeps) {}
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async restore(): Promise<void> {
    const intent = await this.deps.store?.load();
    if (!intent) return;
    if (intent.bookingId !== this.deps.bookingId || intent.kind !== this.deps.kind)
      throw new Error('Mismatched persisted intent');
    this.intent = intent;
    this.update({
      phase: 'unknown',
      preview: null,
      notice: this.deps.now() - intent.createdAt >= 86400000 ? 'reconcile' : 'unknown',
    });
  }
  private update(patch: Partial<ChangeState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  edit(draft: ChangeDraft): void {
    if (!['editing', 'previewed'].includes(this.state.phase)) return;
    this.draft = { ...draft, evidenceRefs: [...draft.evidenceRefs] };
    this.update({ phase: 'editing', preview: null, notice: null });
  }
  private async checkedPreview(): Promise<ChangePreview> {
    if (this.draft === null) throw new Error('Missing draft');
    const result = await this.deps.api.preview(this.draft);
    if (result.kind !== this.deps.kind) throw new Error('Mismatched preview');
    assertPreview(result, this.draft, this.deps.bookingId, this.deps.now());
    return result;
  }
  async preview(): Promise<void> {
    if (!['editing', 'previewed'].includes(this.state.phase) || !this.draft) return;
    this.update({ phase: 'previewing', preview: null, notice: null });
    try {
      await requireOnline(this.deps.net);
      this.update({ phase: 'previewed', preview: await this.checkedPreview() });
    } catch (error) {
      await this.failure(error, false);
    }
  }
  async confirm(): Promise<void> {
    if (this.state.phase !== 'previewed' || this.state.preview === null || this.draft === null)
      return;
    if (this.deps.kind === 'reschedule') {
      this.update({ notice: 'feeUnavailable' });
      return;
    }
    const shown = this.state.preview;
    this.update({ phase: 'submitting', notice: null });
    try {
      await requireOnline(this.deps.net);
      const fresh = await this.checkedPreview();
      if (!samePreview(shown, fresh)) {
        this.update({ phase: 'previewed', preview: fresh, notice: 'changed' });
        return;
      }
      const body = requestBody(fresh, this.draft);
      this.intent = {
        kind: this.deps.kind,
        bookingId: this.deps.bookingId,
        etag: this.deps.etag,
        key: this.deps.createId(),
        createdAt: this.deps.now(),
        body,
      };
      await this.deps.store?.save(this.intent);
      await this.send();
    } catch (error) {
      await this.failure(error, false);
    }
  }
  async retry(): Promise<void> {
    if (this.state.phase !== 'unknown' || this.intent === null) return;
    if (this.deps.now() - this.intent.createdAt >= 86400000) {
      this.update({ notice: 'reconcile' });
      return;
    }
    if (this.deps.now() < this.retryAt) {
      this.update({ notice: 'waiting' });
      return;
    }
    this.update({ phase: 'submitting', notice: null });
    await this.send();
  }
  private async send(): Promise<void> {
    if (!this.intent) return;
    try {
      await requireOnline(this.deps.net);
      const result = await this.deps.api.commit(this.intent);
      assertResult(result, this.intent);
      this.intent = null;
      this.update({ phase: 'done', result, notice: null });
      // Receipt is authoritative even if clearing local storage fails; retained key is safe to replay.
      try {
        await this.deps.store?.clear();
      } catch {
        this.update({ notice: 'storage' });
      }
    } catch (error) {
      await this.failure(error, true);
    }
  }
  private async failure(error: unknown, writing: boolean): Promise<void> {
    const patch = failurePatch(error, writing, this.state);
    if (isApiError(error)) this.retryAt = this.deps.now() + (error.retryAfterSeconds ?? 0) * 1000;
    if (patch.phase !== 'unknown') {
      this.intent = null;
      try {
        await this.deps.store?.clear();
      } catch {
        if (patch.phase === 'denied') {
          this.update(patch);
          return;
        }
        this.update({ phase: 'conflict', preview: null, notice: 'storage' });
        return;
      }
    }
    this.update(patch);
  }
}
