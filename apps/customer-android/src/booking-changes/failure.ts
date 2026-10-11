import { isApiError } from '@pinehill/api-client';
import { OfflineError } from '../netinfo';
import type { ChangeState } from './types';

function uncertain(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.kind !== 'http' ||
    (error.status ?? 500) >= 500 ||
    error.code === 'E_SYS_REQUEST_IN_PROGRESS'
  );
}
export function failurePatch(
  error: unknown,
  writing: boolean,
  state: ChangeState,
): Partial<ChangeState> {
  if (error instanceof OfflineError)
    return {
      phase: writing ? 'unknown' : state.preview ? 'previewed' : 'editing',
      notice: 'offline',
    };
  if (isApiError(error)) {
    if ([401, 403].includes(error.status ?? 0))
      return {
        phase: 'denied',
        preview: null,
        result: null,
        notice: error.status === 401 ? 'expired' : 'forbidden',
      };
    if ([412, 428].includes(error.status ?? 0))
      return { phase: 'conflict', preview: null, notice: 'conflict' };
  }
  return genericPatch(error, writing, state);
}
function genericPatch(error: unknown, writing: boolean, state: ChangeState): Partial<ChangeState> {
  if (writing && uncertain(error))
    return { phase: 'unknown', preview: state.preview, notice: 'unknown' };
  return {
    phase: 'editing',
    preview: null,
    notice: isApiError(error) ? (error.knownCode ?? 'failed') : 'failed',
  };
}
