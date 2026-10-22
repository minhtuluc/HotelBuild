import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { IDLE_TIMEOUT_MS, createIdleWatcher } from '../../src/session/idle';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-22T02:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

test('the published timeout is 15 minutes', () => {
  expect(IDLE_TIMEOUT_MS).toBe(15 * 60 * 1000);
});

test('fires once after the timeout with no activity', () => {
  const onIdle = vi.fn();
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle });
  watcher.start();
  vi.advanceTimersByTime(999);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onIdle).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(10_000);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('activity pushes the deadline out; the timer re-arms for the remainder', () => {
  const onIdle = vi.fn();
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle });
  watcher.start();
  vi.advanceTimersByTime(800);
  watcher.touch();
  vi.advanceTimersByTime(800);
  expect(onIdle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(200);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('many touches cost no timer churn: one pending timer at any time', () => {
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle: () => undefined });
  watcher.start();
  for (let i = 0; i < 500; i += 1) watcher.touch();
  expect(vi.getTimerCount()).toBe(1);
});

test('stop cancels the countdown and start can resume it', () => {
  const onIdle = vi.fn();
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle });
  watcher.start();
  watcher.stop();
  vi.advanceTimersByTime(5000);
  expect(onIdle).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  watcher.start();
  vi.advanceTimersByTime(1000);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('a machine that slept past the deadline is idle as soon as the check runs', () => {
  const onIdle = vi.fn();
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle });
  watcher.start();
  vi.setSystemTime(new Date('2026-10-22T03:00:00.000Z'));
  watcher.check();
  expect(onIdle).toHaveBeenCalledTimes(1);
});

test('touch after idle does not resurrect the watcher', () => {
  const onIdle = vi.fn();
  const watcher = createIdleWatcher({ timeoutMs: 1000, onIdle });
  watcher.start();
  vi.advanceTimersByTime(1000);
  watcher.touch();
  vi.advanceTimersByTime(5000);
  expect(onIdle).toHaveBeenCalledTimes(1);
});
