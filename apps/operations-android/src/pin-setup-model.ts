/** Kiểm tra cục bộ của màn Đặt PIN (SCR-56) trước khi gọi `PUT /auth/pin`. */
import type { SetPinRequest } from '@pinehill/contracts';

export interface PinSetupInput {
  first: string;
  second: string;
  currentPassword: string;
}

export type PinSetupResult =
  | { ok: true; request: SetPinRequest }
  | { ok: false; error: 'pin.setup.mismatch' | 'pin.setup.passwordRequired' };

export function pinSetupRequest(input: PinSetupInput): PinSetupResult {
  if (input.first !== input.second) return { ok: false, error: 'pin.setup.mismatch' };
  if (input.currentPassword === '') return { ok: false, error: 'pin.setup.passwordRequired' };
  return { ok: true, request: { pin: input.first, currentPassword: input.currentPassword } };
}
