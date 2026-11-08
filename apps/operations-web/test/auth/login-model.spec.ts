import { expect, test } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  waitParts,
  loginFailure,
  passwordChangeFailure,
  validateLogin,
  validatePasswordChange,
} from '../../src/session/login-model';

const http = (status: number, code: string) =>
  new ApiError({ kind: 'http', status, code, message: 'x' });

test('validateLogin mirrors the published contract bounds without inventing rules', () => {
  expect(validateLogin({ username: 'letan01', password: 'Synthetic-password' })).toEqual({});
  expect(validateLogin({ username: '  ', password: '' })).toEqual({
    username: 'REQUIRED',
    password: 'REQUIRED',
  });
  expect(validateLogin({ username: 'ab', password: 'short' })).toEqual({
    username: 'LENGTH',
    password: 'LENGTH',
  });
  expect(validateLogin({ username: 'a'.repeat(65), password: 'p'.repeat(129) })).toEqual({
    username: 'LENGTH',
    password: 'LENGTH',
  });
});

test('loginFailure classifies by code and HTTP class only, never by message', () => {
  expect(loginFailure(http(401, 'E_AUTH_INVALID_CREDENTIALS'))).toEqual({ kind: 'invalid' });
  expect(loginFailure(http(401, 'E_AUTH_ACCOUNT_LOCKED'), 42)).toEqual({
    kind: 'locked',
    waitSeconds: 42,
  });
  expect(loginFailure(http(423, 'E_AUTH_ACCOUNT_LOCKED'))).toEqual({ kind: 'locked' });
  expect(loginFailure(http(429, 'E_GEN_RATE_LIMITED'), 30)).toEqual({
    kind: 'rateLimited',
    waitSeconds: 30,
  });
  expect(loginFailure(http(400, 'E_GEN_VALIDATION_FAILED'))).toEqual({ kind: 'invalid' });
  expect(loginFailure(new ApiError({ kind: 'network', message: 'down' }))).toEqual({
    kind: 'network',
  });
  expect(loginFailure(new ApiError({ kind: 'timeout', message: 'slow' }))).toEqual({
    kind: 'network',
  });
  expect(loginFailure(http(502, 'E_GEN_SERVICE_UNAVAILABLE'))).toEqual({ kind: 'network' });
  expect(loginFailure(http(409, 'E_SOMETHING'))).toEqual({ kind: 'unknown', code: 'E_SOMETHING' });
  expect(loginFailure(new Error('boom'))).toEqual({ kind: 'network' });
});

test('a wait taken from the error body wins over a missing header and bad values are dropped', () => {
  const error = new ApiError({
    kind: 'http',
    status: 429,
    code: 'E_GEN_RATE_LIMITED',
    message: 'x',
    retryAfterSeconds: 7,
  });
  expect(loginFailure(error)).toEqual({ kind: 'rateLimited', waitSeconds: 7 });
  expect(loginFailure(http(429, 'E_GEN_RATE_LIMITED'), -3)).toEqual({ kind: 'rateLimited' });
  expect(loginFailure(http(429, 'E_GEN_RATE_LIMITED'), Number.NaN)).toEqual({
    kind: 'rateLimited',
  });
});

test('waitParts speaks seconds under a minute and rounds minutes up', () => {
  expect(waitParts(1)).toEqual({ unit: 'seconds', value: 1 });
  expect(waitParts(42)).toEqual({ unit: 'seconds', value: 42 });
  expect(waitParts(60)).toEqual({ unit: 'minutes', value: 1 });
  expect(waitParts(61)).toEqual({ unit: 'minutes', value: 2 });
  expect(waitParts(900)).toEqual({ unit: 'minutes', value: 15 });
});

test('validatePasswordChange checks required, new length 8-128 and confirmation match', () => {
  expect(
    validatePasswordChange({
      current: 'old-password',
      next: 'new-password-1',
      confirm: 'new-password-1',
    }),
  ).toEqual({});
  expect(validatePasswordChange({ current: '', next: '', confirm: '' })).toEqual({
    current: 'REQUIRED',
    next: 'REQUIRED',
    confirm: 'REQUIRED',
  });
  expect(validatePasswordChange({ current: 'old', next: 'short', confirm: 'short' })).toEqual({
    next: 'LENGTH',
  });
  expect(
    validatePasswordChange({ current: 'old', next: 'p'.repeat(129), confirm: 'p'.repeat(129) }),
  ).toEqual({
    next: 'LENGTH',
  });
  expect(
    validatePasswordChange({ current: 'old', next: 'new-password-1', confirm: 'new-password-2' }),
  ).toEqual({ confirm: 'MISMATCH' });
});

test('passwordChangeFailure maps a wrong current password to its field and keeps unknown outcomes honest', () => {
  expect(passwordChangeFailure(http(401, 'E_AUTH_INVALID_CREDENTIALS'))).toEqual({
    kind: 'wrongCurrent',
  });
  expect(passwordChangeFailure(http(400, 'E_GEN_VALIDATION_FAILED'))).toEqual({ kind: 'invalid' });
  expect(passwordChangeFailure(http(422, 'E_GEN_VALIDATION_FAILED'))).toEqual({ kind: 'invalid' });
  expect(passwordChangeFailure(http(429, 'E_GEN_RATE_LIMITED'))).toEqual({ kind: 'rateLimited' });
  expect(passwordChangeFailure(http(403, 'E_RBAC_FORBIDDEN'))).toEqual({ kind: 'forbidden' });
  expect(passwordChangeFailure(new ApiError({ kind: 'network', message: 'down' }))).toEqual({
    kind: 'unknownOutcome',
  });
  expect(passwordChangeFailure(http(500, 'E_SYS'))).toEqual({ kind: 'unknownOutcome' });
});
