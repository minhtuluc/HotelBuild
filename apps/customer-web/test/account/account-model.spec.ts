import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { guestRegisterRequestSchema } from '@pinehill/contracts';
import {
  GUEST_CONSENT_VERSION,
  failureOf,
  forgotIssues,
  loginIssues,
  normalizePhone,
  registerIssues,
  resetIssues,
  safeNext,
  toRegisterRequest,
  type RegisterForm,
} from '../../src/app/(guest)/account/account-model';

const form = (over: Partial<RegisterForm> = {}): RegisterForm => ({
  fullName: 'Nguyễn Văn An',
  phone: '0912 345 678',
  email: '',
  password: 'S3cret-pass',
  consent: false,
  ...over,
});

describe('normalizePhone', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['0912.345.678', '+84912345678'],
    ['(0912) 345-678', '+84912345678'],
    ['+84912345678', '+84912345678'],
    ['84912345678', '+84912345678'],
    ['  +84 912 345 678 ', '+84912345678'],
  ])('%s → %s (0… and +84… are the same number)', (raw, canonical) => {
    expect(normalizePhone(raw)).toBe(canonical);
  });

  it.each(['', '091234567', '09123456789', '+8491234567', 'abc', '+85912345678', '0912-34x-678'])(
    'rejects %j',
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );
});

describe('registerIssues', () => {
  it('accepts a complete form and leaves consent untouched', () => {
    expect(registerIssues(form())).toEqual({});
  });

  it('reports each field with a machine issue, never free text', () => {
    expect(
      registerIssues(form({ fullName: '  ', phone: '12', email: 'x@', password: 'short' })),
    ).toEqual({ fullName: 'REQUIRED', phone: 'PHONE', email: 'EMAIL', password: 'TOO_SHORT' });
  });

  it('bounds name and password like the contract', () => {
    expect(registerIssues(form({ fullName: 'a'.repeat(121) })).fullName).toBe('TOO_LONG');
    expect(registerIssues(form({ password: 'a'.repeat(129) })).password).toBe('TOO_LONG');
    expect(registerIssues(form({ password: 'a'.repeat(8) }))).toEqual({});
  });

  it('treats a blank email as absent but validates a given one', () => {
    expect(registerIssues(form({ email: '' }))).toEqual({});
    expect(registerIssues(form({ email: 'an@example.com' }))).toEqual({});
    expect(registerIssues(form({ email: 'an example@x.com' })).email).toBe('EMAIL');
  });
});

describe('toRegisterRequest', () => {
  it('builds a body the published contract accepts, canonical phone, versioned consent', () => {
    const body = toRegisterRequest(form({ consent: true, email: ' an@example.com ' }));
    expect(body).toEqual({
      phone: '+84912345678',
      fullName: 'Nguyễn Văn An',
      email: 'an@example.com',
      password: 'S3cret-pass',
      consentMarketing: true,
      consentVersion: GUEST_CONSENT_VERSION,
    });
    expect(guestRegisterRequestSchema.safeParse(body).success).toBe(true);
  });

  it('never ticks marketing consent for the user and omits a blank email', () => {
    const body = toRegisterRequest(form());
    expect(body.consentMarketing).toBe(false);
    expect('email' in body).toBe(false);
  });

  it('refuses to build from an invalid form instead of sending a bad phone', () => {
    expect(() => toRegisterRequest(form({ phone: 'nope' }))).toThrow(RangeError);
  });
});

describe('loginIssues / forgotIssues / resetIssues', () => {
  it('login needs a valid phone and an 8+ char password', () => {
    expect(loginIssues({ phone: '0912345678', password: 'S3cret-pass' })).toEqual({});
    expect(loginIssues({ phone: '', password: '' })).toEqual({
      phone: 'REQUIRED',
      password: 'REQUIRED',
    });
    expect(loginIssues({ phone: '1', password: 'short' })).toEqual({
      phone: 'PHONE',
      password: 'TOO_SHORT',
    });
  });

  it('forgot-password only needs the phone', () => {
    expect(forgotIssues({ phone: '+84912345678' })).toEqual({});
    expect(forgotIssues({ phone: '' })).toEqual({ phone: 'REQUIRED' });
    expect(forgotIssues({ phone: '123' })).toEqual({ phone: 'PHONE' });
  });

  it('reset needs a token, a valid new password typed twice', () => {
    expect(resetIssues({ token: 't', password: 'S3cret-pass', confirm: 'S3cret-pass' })).toEqual(
      {},
    );
    expect(resetIssues({ token: '', password: 'S3cret-pass', confirm: 'S3cret-pass' })).toEqual({
      token: 'REQUIRED',
    });
    expect(resetIssues({ token: 't', password: 'S3cret-pass', confirm: 'S3cret-pasS' })).toEqual({
      confirm: 'MISMATCH',
    });
    expect(resetIssues({ token: 't', password: 'short', confirm: 'short' })).toEqual({
      password: 'TOO_SHORT',
    });
  });
});

describe('safeNext', () => {
  it.each([
    ['/bookings', '/bookings'],
    ['/bookings?tab=1#x', '/bookings?tab=1#x'],
    [null, '/profile'],
    ['', '/profile'],
    ['https://evil.example/', '/profile'],
    ['//evil.example', '/profile'],
    ['/\\evil.example', '/profile'],
    ['javascript:alert(1)', '/profile'],
    ['/account/login', '/profile'],
    ['/account/register?next=/x', '/profile'],
  ])('%j → %s (internal paths only)', (raw, expected) => {
    expect(safeNext(raw)).toBe(expected);
  });
});

const http = (status: number, code?: string): ApiError =>
  new ApiError({ kind: 'http', status, ...(code === undefined ? {} : { code }), message: 'x' });

describe('failureOf', () => {
  it.each([
    [http(409, 'E_AUTH_PHONE_REGISTERED'), 'phoneRegistered'],
    [http(401, 'E_AUTH_INVALID_CREDENTIALS'), 'invalidCredentials'],
    [http(423, 'E_AUTH_ACCOUNT_LOCKED'), 'locked'],
    [http(401, 'E_AUTH_ACCOUNT_LOCKED'), 'locked'],
    [http(429, 'E_GEN_RATE_LIMITED'), 'rateLimited'],
    [http(429), 'rateLimited'],
    [http(400, 'E_AUTH_RESET_TOKEN_INVALID'), 'resetTokenInvalid'],
    [http(422, 'E_CRM_PHONE_INVALID'), 'validation'],
    [http(400, 'E_GEN_VALIDATION_FAILED'), 'validation'],
    [http(503, 'E_GEN_SERVICE_UNAVAILABLE'), 'unavailable'],
    [http(500), 'unavailable'],
    [new ApiError({ kind: 'network', message: 'x' }), 'unknownOutcome'],
    [new ApiError({ kind: 'timeout', message: 'x' }), 'unknownOutcome'],
    [new ApiError({ kind: 'protocol', message: 'x' }), 'unknownOutcome'],
    [new Error('boom'), 'unknownOutcome'],
    [http(418, 'E_SOMETHING_NEW'), 'other'],
  ])('%#', (error, kind) => {
    expect(failureOf(error)).toBe(kind);
  });
});
