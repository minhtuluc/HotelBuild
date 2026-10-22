import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import {
  runForgot,
  runLogin,
  runRegister,
  runReset,
  type FlowDeps,
} from '../../src/app/(guest)/account/account-flows';

const http = (status: number, code: string): ApiError =>
  new ApiError({ kind: 'http', status, code, message: 'x' });

function deps(over: Partial<FlowDeps> = {}) {
  return {
    register: vi.fn<FlowDeps['register']>(over.register ?? (async () => undefined)),
    login: vi.fn<FlowDeps['login']>(over.login ?? (async () => undefined)),
    requestReset: vi.fn<FlowDeps['requestReset']>(over.requestReset ?? (async () => undefined)),
    confirmReset: vi.fn<FlowDeps['confirmReset']>(over.confirmReset ?? (async () => undefined)),
  };
}

const registerForm = {
  fullName: 'Nguyễn Văn An',
  phone: '0912 345 678',
  email: '',
  password: 'S3cret-pass',
  consent: false,
};

describe('runRegister', () => {
  it('registers with the canonical phone, then signs in with the same credentials', async () => {
    const d = deps();
    expect(await runRegister(registerForm, d)).toEqual({ kind: 'done' });
    expect(d.register).toHaveBeenCalledWith({
      phone: '+84912345678',
      fullName: 'Nguyễn Văn An',
      password: 'S3cret-pass',
      consentMarketing: false,
      consentVersion: '2026-10',
    });
    expect(d.login).toHaveBeenCalledWith('+84912345678', 'S3cret-pass');
  });

  it('shows field issues and sends nothing for an invalid form', async () => {
    const d = deps();
    const outcome = await runRegister({ ...registerForm, phone: '12', password: 'x' }, d);
    expect(outcome).toEqual({ kind: 'issues', issues: { phone: 'PHONE', password: 'TOO_SHORT' } });
    expect(d.register).not.toHaveBeenCalled();
    expect(d.login).not.toHaveBeenCalled();
  });

  it('a phone that already has a profile is reported and no login is attempted', async () => {
    const d = deps({
      register: vi.fn(async () => {
        throw http(409, 'E_AUTH_PHONE_REGISTERED');
      }),
    });
    expect(await runRegister(registerForm, d)).toEqual({
      kind: 'failed',
      failure: 'phoneRegistered',
    });
    expect(d.login).not.toHaveBeenCalled();
  });

  it('a lost answer is an unknown outcome: no login attempt, user told to try signing in', async () => {
    const d = deps({
      register: vi.fn(async () => {
        throw new ApiError({ kind: 'timeout', message: 'x' });
      }),
    });
    expect(await runRegister(registerForm, d)).toEqual({
      kind: 'failed',
      failure: 'unknownOutcome',
    });
    expect(d.login).not.toHaveBeenCalled();
  });

  it('account created but sign-in refused is its own outcome (never "registration failed")', async () => {
    const d = deps({
      login: vi.fn(async () => {
        throw http(429, 'E_GEN_RATE_LIMITED');
      }),
    });
    expect(await runRegister(registerForm, d)).toEqual({ kind: 'createdNotSignedIn' });
  });
});

describe('runLogin', () => {
  it('signs in with the canonical phone', async () => {
    const d = deps();
    expect(await runLogin({ phone: '0912345678', password: 'S3cret-pass' }, d)).toEqual({
      kind: 'done',
    });
    expect(d.login).toHaveBeenCalledWith('+84912345678', 'S3cret-pass');
  });

  it.each([
    [http(401, 'E_AUTH_INVALID_CREDENTIALS'), 'invalidCredentials'],
    [http(423, 'E_AUTH_ACCOUNT_LOCKED'), 'locked'],
    [http(429, 'E_GEN_RATE_LIMITED'), 'rateLimited'],
    [new ApiError({ kind: 'network', message: 'x' }), 'unknownOutcome'],
  ] as const)('maps %# to %s', async (error, failure) => {
    const d = deps({
      login: vi.fn(async () => {
        throw error;
      }),
    });
    expect(await runLogin({ phone: '0912345678', password: 'S3cret-pass' }, d)).toEqual({
      kind: 'failed',
      failure,
    });
  });

  it('does not call the server for an invalid form', async () => {
    const d = deps();
    expect(await runLogin({ phone: '', password: '' }, d)).toEqual({
      kind: 'issues',
      issues: { phone: 'REQUIRED', password: 'REQUIRED' },
    });
    expect(d.login).not.toHaveBeenCalled();
  });
});

describe('runForgot', () => {
  it('answers "sent" the same way regardless of what the server knows', async () => {
    const d = deps();
    expect(await runForgot({ phone: '0912345678' }, d)).toEqual({ kind: 'sent' });
    expect(d.requestReset).toHaveBeenCalledWith('+84912345678');
  });

  it('reports rate limiting and lost answers, never "sent"', async () => {
    const limited = deps({
      requestReset: vi.fn(async () => {
        throw http(429, 'E_GEN_RATE_LIMITED');
      }),
    });
    expect(await runForgot({ phone: '0912345678' }, limited)).toEqual({
      kind: 'failed',
      failure: 'rateLimited',
    });
    const lost = deps({
      requestReset: vi.fn(async () => {
        throw new ApiError({ kind: 'network', message: 'x' });
      }),
    });
    expect(await runForgot({ phone: '0912345678' }, lost)).toEqual({
      kind: 'failed',
      failure: 'unknownOutcome',
    });
  });

  it('rejects an invalid phone locally', async () => {
    const d = deps();
    expect(await runForgot({ phone: 'abc' }, d)).toEqual({
      kind: 'issues',
      issues: { phone: 'PHONE' },
    });
    expect(d.requestReset).not.toHaveBeenCalled();
  });
});

describe('runReset', () => {
  const form = { token: 'tok-1', password: 'N3w-secret!', confirm: 'N3w-secret!' };

  it('confirms with the token and the new password', async () => {
    const d = deps();
    expect(await runReset(form, d)).toEqual({ kind: 'done' });
    expect(d.confirmReset).toHaveBeenCalledWith('tok-1', 'N3w-secret!');
  });

  it('refuses mismatching passwords before any request', async () => {
    const d = deps();
    expect(await runReset({ ...form, confirm: 'other-secret' }, d)).toEqual({
      kind: 'issues',
      issues: { confirm: 'MISMATCH' },
    });
    expect(d.confirmReset).not.toHaveBeenCalled();
  });

  it('an invalid or used token tells the user to request a new link', async () => {
    const d = deps({
      confirmReset: vi.fn(async () => {
        throw http(400, 'E_AUTH_RESET_TOKEN_INVALID');
      }),
    });
    expect(await runReset(form, d)).toEqual({ kind: 'failed', failure: 'resetTokenInvalid' });
  });
});
