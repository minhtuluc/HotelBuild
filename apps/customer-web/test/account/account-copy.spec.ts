import { describe, expect, it } from 'vitest';
import { viAccount as messages } from '../../src/i18n/catalogs/vi/account';
import { translatorsFor } from '../../src/i18n/translate';
import { failureLines, issueMessage, type Flow } from '../../src/app/(guest)/account/account-copy';
import type { AccountFailure, FieldIssue } from '../../src/app/(guest)/account/account-model';

const FAILURES: AccountFailure[] = [
  'phoneRegistered',
  'invalidCredentials',
  'locked',
  'rateLimited',
  'resetTokenInvalid',
  'validation',
  'unavailable',
  'unknownOutcome',
  'other',
];
const FLOWS: Flow[] = ['register', 'login', 'forgot', 'reset'];
const text = translatorsFor('vi').account;
const ISSUES: FieldIssue[] = ['REQUIRED', 'PHONE', 'EMAIL', 'TOO_SHORT', 'TOO_LONG', 'MISMATCH'];

describe('failureLines', () => {
  it('every failure in every flow yields at least one non-empty, non-placeholder sentence', () => {
    for (const flow of FLOWS)
      for (const failure of FAILURES) {
        const lines = failureLines(text, failure, flow, null);
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect(line.trim()).not.toBe('');
          expect(line).not.toMatch(/\{\w+\}/);
        }
      }
  });

  it('a phone that already has a profile points to the front desk, with the configured contact', () => {
    expect(failureLines(text, 'phoneRegistered', 'register', 'Lễ tân: 0263 000 000')).toEqual([
      messages.phoneRegistered,
      'Liên hệ lễ tân: Lễ tân: 0263 000 000',
    ]);
    expect(failureLines(text, 'phoneRegistered', 'register', null)).toEqual([
      messages.phoneRegistered,
      messages.contactGeneric,
    ]);
  });

  it('a lost answer is worded per flow and never as a certain failure', () => {
    expect(failureLines(text, 'unknownOutcome', 'register', null)).toEqual([
      messages.registerUnknown,
    ]);
    expect(failureLines(text, 'unknownOutcome', 'login', null)).toEqual([messages.loginUnknown]);
    expect(failureLines(text, 'unknownOutcome', 'forgot', null)).toEqual([messages.forgotUnknown]);
    expect(failureLines(text, 'unknownOutcome', 'reset', null)).toEqual([messages.resetUnknown]);
  });

  it('wrong credentials never say whether the phone has an account beyond the generic sentence', () => {
    expect(failureLines(text, 'invalidCredentials', 'login', null)).toEqual([
      messages.invalidCredentials,
    ]);
    expect(messages.invalidCredentials).not.toMatch(/không tồn tại|chưa đăng ký/i);
  });
});

describe('issueMessage', () => {
  it('has a sentence for each issue', () => {
    for (const issue of ISSUES) expect(issueMessage(text, issue).trim()).not.toBe('');
  });
});
