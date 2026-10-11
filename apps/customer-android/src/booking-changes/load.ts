import { createBookingApi, isApiError, ApiError, type ApiClient } from '@pinehill/api-client';
import type { KeyValueStorage } from '../storage';
import { OfflineError, requireOnline, type NetInfoSource } from '../netinfo';
import { findByCode } from '../orders';
import { ChangeController } from './controller';
import { changeApiFrom } from './api';
import { intentStore } from './intent-store';
import type { ChangeDraft, ChangeKind } from './types';

export async function loadChange(
  deps: {
    session: { silentRefresh(): Promise<boolean>; apiClient(): ApiClient };
    net: NetInfoSource;
    storage: KeyValueStorage;
    createId(): string;
    now(): number;
  },
  code: string,
  kind: ChangeKind,
) {
  await requireOnline(deps.net);
  if (!(await deps.session.silentRefresh()))
    throw new ApiError({ kind: 'http', status: 401, message: 'Expired session' });
  const api = createBookingApi(deps.session.apiClient());
  const page = await api.list({ q: code, limit: 20 });
  const match = findByCode(page.data.data, code);
  if (!match)
    throw new ApiError({
      kind: 'http',
      status: 404,
      code: 'E_GEN_NOT_FOUND',
      message: 'No booking',
    });
  const detail = await api.get(match.id);
  if (!detail.etag) throw new ApiError({ kind: 'http', status: 428, message: 'Missing version' });
  const next = new ChangeController({
    kind,
    bookingId: detail.data.id,
    etag: detail.etag,
    api: changeApiFrom(deps.session.apiClient(), detail.data, kind),
    net: deps.net,
    now: deps.now,
    createId: deps.createId,
    store: intentStore(deps.storage, detail.data.guestId, detail.data.id, kind),
  });
  const initial: ChangeDraft = {
    reason: 'GUEST_REQUEST',
    note: '',
    evidenceRefs: [],
    checkIn: detail.data.checkIn,
    checkOut: detail.data.checkOut,
  };
  next.edit(initial);
  await next.restore();
  return { booking: detail.data, controller: next, draft: initial };
}
export function loadFailure(error: unknown): string {
  if (error instanceof OfflineError) return 'offline';
  if (!isApiError(error)) return 'failed';
  if (error.status === 401) return 'expired';
  if (error.status === 403) return 'forbidden';
  if (error.status === 428) return 'missingVersion';
  return error.knownCode ?? 'failed';
}
