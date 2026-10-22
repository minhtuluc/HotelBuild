/** Chuyển kết quả phân loại (hàm thuần ở `login-model.ts`) thành câu chữ hiển thị; không có luật nào ở đây. */
import {
  formatWait,
  type FieldIssue,
  type LoginFailure,
  type PasswordChangeFailure,
} from './login-model';
import { authText as text } from './messages';

export type FieldName = 'username' | 'password' | 'current' | 'next' | 'confirm';

export function issueMessage(field: FieldName, issue: FieldIssue): string {
  if (issue === 'REQUIRED') return text('required');
  if (issue === 'MISMATCH') return text('mismatch');
  if (field === 'username') return text('usernameLength');
  return text(field === 'next' ? 'newLength' : 'passwordLength');
}

export function loginFailureMessage(failure: LoginFailure): string {
  switch (failure.kind) {
    case 'invalid':
      return text('loginInvalid');
    case 'locked':
      return failure.waitSeconds === undefined
        ? text('loginLockedNoWait')
        : text('loginLocked', { wait: formatWait(failure.waitSeconds) });
    case 'rateLimited':
      return failure.waitSeconds === undefined
        ? text('loginRateLimitedNoWait')
        : text('loginRateLimited', { wait: formatWait(failure.waitSeconds) });
    case 'network':
      return text('loginNetwork');
    case 'unknown':
      return text('loginUnknown', { code: failure.code });
  }
}

export function passwordFailureMessage(failure: PasswordChangeFailure): string {
  switch (failure.kind) {
    case 'wrongCurrent':
      return text('changeWrongCurrent');
    case 'invalid':
      return text('changeInvalid');
    case 'rateLimited':
      return text('changeRateLimited');
    case 'forbidden':
      return text('changeForbidden');
    case 'unknownOutcome':
      return text('changeUnknown');
  }
}
