/** Chọn câu chữ cho lỗi biểu mẫu và kết quả thất bại của SCR-08 (thuần, không phụ thuộc React). */
import { accountText as text } from './messages';
import type { AccountFailure, FieldIssue } from './account-model';

export type Flow = 'register' | 'login' | 'forgot' | 'reset';

const ISSUE_KEYS = {
  REQUIRED: 'issueRequired',
  PHONE: 'issuePhone',
  EMAIL: 'issueEmail',
  TOO_SHORT: 'issueTooShort',
  TOO_LONG: 'issueTooLong',
  MISMATCH: 'issueMismatch',
} as const satisfies Record<FieldIssue, Parameters<typeof text>[0]>;

export function issueMessage(issue: FieldIssue): string {
  return text(ISSUE_KEYS[issue]);
}

const UNKNOWN_KEYS = {
  register: 'registerUnknown',
  login: 'loginUnknown',
  forgot: 'forgotUnknown',
  reset: 'resetUnknown',
} as const satisfies Record<Flow, Parameters<typeof text>[0]>;

const DIRECT_KEYS = {
  invalidCredentials: 'invalidCredentials',
  locked: 'locked',
  rateLimited: 'rateLimited',
  resetTokenInvalid: 'resetTokenInvalid',
  validation: 'validation',
  unavailable: 'unavailable',
  other: 'other',
} as const satisfies Record<
  Exclude<AccountFailure, 'phoneRegistered' | 'unknownOutcome'>,
  Parameters<typeof text>[0]
>;

/**
 * Các câu hiển thị cho một thất bại. SĐT đã có hồ sơ → hướng dẫn liên hệ lễ tân kèm thông tin liên hệ cấu
 * hình được (thiếu thì lời hướng dẫn chung). Mất mạng/hết giờ là "chưa xác định kết quả" theo từng luồng.
 */
export function failureLines(
  failure: AccountFailure,
  flow: Flow,
  contact: string | null,
): readonly string[] {
  if (failure === 'phoneRegistered')
    return [
      text('phoneRegistered'),
      contact === null ? text('contactGeneric') : text('contactLine', { contact }),
    ];
  if (failure === 'unknownOutcome') return [text(UNKNOWN_KEYS[flow])];
  return [text(DIRECT_KEYS[failure])];
}
