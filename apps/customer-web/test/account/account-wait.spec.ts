import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { failureLines, waitLine } from '../../src/app/(guest)/account/account-copy';
import { runForgot, runLogin, type FlowDeps } from '../../src/app/(guest)/account/account-flows';
import { waitSecondsOf } from '../../src/app/(guest)/account/account-model';
import { translatorsFor } from '../../src/i18n/translate';

/** HB-324 (TD-41): báo thời gian chờ khi tài khoản bị khoá hoặc bị giới hạn tần suất (Retry-After). */

const limited = (status: number, code: string, retryAfterSeconds?: number): ApiError =>
  new ApiError({
    kind: 'http',
    status,
    code,
    message: 'x',
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });

function deps(fail: ApiError): FlowDeps {
  return {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => {
      throw fail;
    }),
    requestReset: vi.fn(async () => {
      throw fail;
    }),
    confirmReset: vi.fn(async () => undefined),
  };
}

describe('thời gian chờ', () => {
  it('chỉ lấy khi bị khoá hoặc giới hạn tần suất; làm tròn lên; bỏ giá trị lạ', () => {
    expect(waitSecondsOf(limited(423, 'E_AUTH_ACCOUNT_LOCKED', 900))).toBe(900);
    expect(waitSecondsOf(limited(429, 'E_GEN_RATE_LIMITED', 41.2))).toBe(42);
    expect(waitSecondsOf(limited(401, 'E_AUTH_INVALID_CREDENTIALS', 30))).toBeUndefined();
    expect(waitSecondsOf(limited(429, 'E_GEN_RATE_LIMITED'))).toBeUndefined();
    expect(waitSecondsOf(limited(429, 'E_GEN_RATE_LIMITED', 0))).toBeUndefined();
    expect(waitSecondsOf(new Error('x'))).toBeUndefined();
  });

  it('đăng nhập và quên mật khẩu mang thời gian chờ vào kết quả thất bại', async () => {
    const locked = limited(423, 'E_AUTH_ACCOUNT_LOCKED', 600);
    expect(await runLogin({ phone: '0912345678', password: 'S3cret-pass' }, deps(locked))).toEqual({
      kind: 'failed',
      failure: 'locked',
      waitSeconds: 600,
    });
    expect(
      await runForgot({ phone: '0912345678' }, deps(limited(429, 'E_GEN_RATE_LIMITED', 30))),
    ).toEqual({
      kind: 'failed',
      failure: 'rateLimited',
      waitSeconds: 30,
    });
    expect(
      await runLogin(
        { phone: '0912345678', password: 'S3cret-pass' },
        deps(limited(401, 'E_AUTH_INVALID_CREDENTIALS')),
      ),
    ).toEqual({ kind: 'failed', failure: 'invalidCredentials' });
  });

  it('câu báo: dưới 2 phút theo giây, từ 2 phút theo phút (làm tròn lên); chỉ thêm khi bị khoá/giới hạn', () => {
    const { account } = translatorsFor('vi');
    expect(waitLine(account, 45)).toBe('Thử lại sau 45 giây.');
    expect(waitLine(account, 121)).toBe('Thử lại sau khoảng 3 phút.');
    expect(failureLines(account, 'locked', 'login', null, 900)).toEqual([
      account('locked'),
      'Thử lại sau khoảng 15 phút.',
    ]);
    expect(failureLines(account, 'locked', 'login', null)).toEqual([account('locked')]);
    expect(failureLines(account, 'invalidCredentials', 'login', null, 60)).toEqual([
      account('invalidCredentials'),
    ]);
  });
});
