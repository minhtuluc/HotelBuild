/** Chọn câu chữ cho lỗi biểu mẫu và kết quả thất bại của SCR-08 (thuần, không phụ thuộc React). */
import type { AccountMessageKey } from '../../../i18n/catalogs';
import type { AccountTranslate } from '../../../i18n/translate';
import type { AccountFailure, FieldIssue } from './account-model';

export type Flow = 'register' | 'login' | 'forgot' | 'reset';

const ISSUE_KEYS = {
  REQUIRED: 'issueRequired',
  PHONE: 'issuePhone',
  EMAIL: 'issueEmail',
  TOO_SHORT: 'issueTooShort',
  TOO_LONG: 'issueTooLong',
  MISMATCH: 'issueMismatch',
} as const satisfies Record<FieldIssue, AccountMessageKey>;

export function issueMessage(text: AccountTranslate, issue: FieldIssue): string {
  return text(ISSUE_KEYS[issue]);
}

const UNKNOWN_KEYS = {
  register: 'registerUnknown',
  login: 'loginUnknown',
  forgot: 'forgotUnknown',
  reset: 'resetUnknown',
} as const satisfies Record<Flow, AccountMessageKey>;

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
  AccountMessageKey
>;

/** "Thử lại sau N giây" dưới 2 phút, "sau khoảng N phút" từ 2 phút trở lên (làm tròn lên). */
export function waitLine(text: AccountTranslate, seconds: number): string {
  return seconds < 120
    ? text('retryInSeconds', { n: seconds })
    : text('retryInMinutes', { n: Math.ceil(seconds / 60) });
}

/**
 * Các câu hiển thị cho một thất bại. SĐT đã có hồ sơ → hướng dẫn liên hệ lễ tân kèm thông tin liên hệ cấu
 * hình được (thiếu thì lời hướng dẫn chung). Mất mạng/hết giờ là "chưa xác định kết quả" theo từng luồng.
 */
export function failureLines(
  text: AccountTranslate,
  failure: AccountFailure,
  flow: Flow,
  contact: string | null,
  waitSeconds?: number,
): readonly string[] {
  if (failure === 'phoneRegistered')
    return [
      text('phoneRegistered'),
      contact === null ? text('contactGeneric') : text('contactLine', { contact }),
    ];
  if (failure === 'unknownOutcome') return [text(UNKNOWN_KEYS[flow])];
  const wait =
    waitSeconds === undefined || (failure !== 'locked' && failure !== 'rateLimited')
      ? []
      : [waitLine(text, waitSeconds)];
  return [text(DIRECT_KEYS[failure]), ...wait];
}
