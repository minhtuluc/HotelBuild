import { phoneNumberSchema } from '@pinehill/contracts';
import { AppError } from '../../../common/app-error.js';

/**
 * BR-CRM-01 + NFR-LOC-04: khách được nhận diện duy nhất theo SĐT **đã chuẩn hoá** `+84XXXXXXXXX`.
 * Máy khách có thể gửi dạng nội địa `0XXXXXXXXX` (hoặc có dấu cách/`.`/`-`); máy chủ chuẩn hoá về dạng
 * canonical trước khi so trùng. Sai mẫu → `422 E_CRM_PHONE_INVALID` (errors.ts).
 */
export function phoneInvalid(): AppError {
  return new AppError(422, 'E_CRM_PHONE_INVALID', 'Số điện thoại không hợp lệ.');
}

export function normalizePhone(raw: string): string {
  const compact = raw.replaceAll(/[\s().-]/g, '');
  const candidate = /^0\d{9}$/.test(compact)
    ? `+84${compact.slice(1)}`
    : /^84\d{9}$/.test(compact)
      ? `+${compact}`
      : compact;
  const parsed = phoneNumberSchema.safeParse(candidate);
  if (!parsed.success) throw phoneInvalid();
  return parsed.data;
}
