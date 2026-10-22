import { expect, test } from 'vitest';
import {
  countdownToMark,
  formatCountdown,
  markInstantMs,
  noShowBody,
  reasonIssue,
} from '../src/no-show/model';

test('reasonIssue requires a non-blank reason of at most 500 characters', () => {
  expect(reasonIssue('Khách không liên lạc được')).toBeNull();
  expect(reasonIssue('')).toBe('EMPTY');
  expect(reasonIssue('   ')).toBe('EMPTY');
  expect(reasonIssue('x'.repeat(500))).toBeNull();
  expect(reasonIssue('x'.repeat(501))).toBe('TOO_LONG');
  expect(reasonIssue(`  ${'x'.repeat(500)}  `)).toBeNull();
});

test('noShowBody trims the reason and carries only the contract fields', () => {
  expect(noShowBody('b1', '  Khách báo hủy qua điện thoại  ')).toEqual({
    bookingId: 'b1',
    reason: 'Khách báo hủy qua điện thoại',
  });
});

test('the mark is 23:59 Vietnam time on the check-in date', () => {
  expect(markInstantMs('2026-10-22')).toBe(Date.parse('2026-10-22T16:59:00.000Z'));
  expect(markInstantMs('2026-10-22x')).toBeNull();
  expect(markInstantMs('2026-13-45')).toBeNull();
  expect(markInstantMs('')).toBeNull();
});

test('countdownToMark counts down, and reaches exactly at 23:59:00 inclusive (BR-FO-02)', () => {
  const mark = Date.parse('2026-10-22T16:59:00.000Z');
  expect(countdownToMark('2026-10-22', mark - 3_725_000)).toEqual({
    kind: 'counting',
    remainingMs: 3_725_000,
  });
  expect(countdownToMark('2026-10-22', mark - 1)).toEqual({ kind: 'counting', remainingMs: 1 });
  expect(countdownToMark('2026-10-22', mark)).toEqual({ kind: 'reached' });
  expect(countdownToMark('2026-10-22', mark + 60_000)).toEqual({ kind: 'reached' });
  expect(countdownToMark('nope', mark)).toEqual({ kind: 'unknown' });
});

test('formatCountdown renders HH:mm:ss rounding partial seconds up', () => {
  expect(formatCountdown(3_725_000)).toBe('01:02:05');
  expect(formatCountdown(1)).toBe('00:00:01');
  expect(formatCountdown(59_000)).toBe('00:00:59');
  expect(formatCountdown(26 * 3_600_000)).toBe('26:00:00');
  expect(formatCountdown(0)).toBe('00:00:00');
});
