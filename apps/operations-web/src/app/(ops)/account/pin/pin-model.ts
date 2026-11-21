/**
 * Go-live — đặt/đổi PIN thao tác 6 số (HB-015, `PUT /auth/pin`) ngay trên web vận hành. Trước đây chỉ app
 * Android có màn này, nên lễ tân chỉ dùng web không bao giờ thu tiền được (lệnh tài chính 🔒 đòi PIN).
 */
import type { SetPinRequest } from '@pinehill/contracts';

export interface PinForm {
  readonly currentPassword: string;
  readonly pin: string;
  readonly confirm: string;
}

export type PinFormIssue = 'PASSWORD' | 'PIN' | 'CONFIRM';

export const EMPTY_PIN_FORM: PinForm = { currentPassword: '', pin: '', confirm: '' };

export function pinFormIssue(form: PinForm): PinFormIssue | null {
  if (form.currentPassword === '') return 'PASSWORD';
  if (!/^\d{6}$/.test(form.pin)) return 'PIN';
  if (form.confirm !== form.pin) return 'CONFIRM';
  return null;
}

export function setPinBody(form: PinForm): SetPinRequest {
  return { pin: form.pin, currentPassword: form.currentPassword };
}
