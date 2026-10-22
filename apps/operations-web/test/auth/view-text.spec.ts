import { expect, test } from 'vitest';
import {
  issueMessage,
  loginFailureMessage,
  passwordFailureMessage,
} from '../../src/session/view-text';

test('field issues speak the published bounds per field', () => {
  expect(issueMessage('username', 'REQUIRED')).toBe('Bắt buộc nhập.');
  expect(issueMessage('username', 'LENGTH')).toBe('Tên đăng nhập gồm 3–64 ký tự.');
  expect(issueMessage('password', 'LENGTH')).toBe('Mật khẩu gồm 8–128 ký tự.');
  expect(issueMessage('next', 'LENGTH')).toBe('Mật khẩu mới gồm 8–128 ký tự.');
  expect(issueMessage('confirm', 'MISMATCH')).toBe('Mật khẩu xác nhận không khớp.');
});

test('login failures name the wait the server gave, and stay honest without one', () => {
  expect(loginFailureMessage({ kind: 'locked', waitSeconds: 42 })).toBe(
    'Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau 42 giây.',
  );
  expect(loginFailureMessage({ kind: 'locked', waitSeconds: 900 })).toContain('15 phút');
  expect(loginFailureMessage({ kind: 'locked' })).toContain('ít phút');
  expect(loginFailureMessage({ kind: 'rateLimited', waitSeconds: 30 })).toContain('30 giây');
  expect(loginFailureMessage({ kind: 'rateLimited' })).toContain('Chờ một lát');
  expect(loginFailureMessage({ kind: 'invalid' })).toBe('Tên đăng nhập hoặc mật khẩu không đúng.');
  expect(loginFailureMessage({ kind: 'network' })).toContain('Không kết nối được');
  expect(loginFailureMessage({ kind: 'unknown', code: 'E_X' })).toContain('E_X');
});

test('an unknown password-change outcome never claims failure or success', () => {
  const message = passwordFailureMessage({ kind: 'unknownOutcome' });
  expect(message).toContain('Chưa xác định kết quả');
  expect(passwordFailureMessage({ kind: 'wrongCurrent' })).toBe('Mật khẩu hiện tại không đúng.');
});
