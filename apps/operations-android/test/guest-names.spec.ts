import { expect, test, vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { GuestSummary } from '@pinehill/contracts';
import { GuestNames, NAME_CONCURRENCY } from '../src/arrivals/guest-names';

const guest = (id: string, fullName: string): GuestSummary => ({
  id,
  fullName,
  phone: '+84912345678',
  email: null,
  loyaltyTier: 'GUEST',
  loyaltyPoints: 0,
  totalStays: 0,
  blacklisted: false,
  consentMarketing: false,
  createdAt: '2026-10-01T00:00:00.000Z',
});

const http = (status: number) => new ApiError({ kind: 'http', status, code: 'E_X', message: 'x' });

test('loads each distinct guest once and exposes only the full name', async () => {
  const fetchGuest = vi.fn(async (id: string) => guest(id, `Khách ${id}`));
  const names = new GuestNames(fetchGuest);
  await names.ensure(['g1', 'g2', 'g1', 'g2']);
  expect(fetchGuest.mock.calls.map((call) => call[0]).sort()).toEqual(['g1', 'g2']);
  expect(names.get('g1')).toBe('Khách g1');
  expect(names.get('g2')).toBe('Khách g2');
  expect(names.get('never-asked')).toBeNull();
  await names.ensure(['g1']);
  expect(fetchGuest).toHaveBeenCalledTimes(2);
});

test('never runs more than NAME_CONCURRENCY requests at once', async () => {
  let active = 0;
  let peak = 0;
  const fetchGuest = async (id: string) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return guest(id, id);
  };
  const names = new GuestNames(fetchGuest);
  await names.ensure(Array.from({ length: 25 }, (_, i) => `g${i}`));
  expect(peak).toBeLessThanOrEqual(NAME_CONCURRENCY);
  expect(peak).toBeGreaterThan(1);
});

test.each([404, 403, 500])(
  'HTTP %s leaves the card without a name and never throws',
  async (status) => {
    const names = new GuestNames(async () => {
      throw http(status);
    });
    await expect(names.ensure(['g1'])).resolves.toBeUndefined();
    expect(names.get('g1')).toBeNull();
  },
);

test('a network failure is retried by the next ensure, a 404 is not', async () => {
  let down = true;
  const fetchGuest = vi.fn(async (id: string) => {
    if (id === 'gone') throw http(404);
    if (down) throw new ApiError({ kind: 'network', message: 'down' });
    return guest(id, 'An');
  });
  const names = new GuestNames(fetchGuest);
  await names.ensure(['g1', 'gone']);
  expect(names.get('g1')).toBeNull();
  down = false;
  await names.ensure(['g1', 'gone']);
  expect(names.get('g1')).toBe('An');
  expect(fetchGuest.mock.calls.filter((call) => call[0] === 'gone')).toHaveLength(1);
});

test('a response for another guest id is discarded', async () => {
  const names = new GuestNames(async () => guest('other', 'Sai người'));
  await names.ensure(['g1']);
  expect(names.get('g1')).toBeNull();
});

test('clear forgets every name (session or property change) and drops in-flight results', async () => {
  let release: () => void = () => undefined;
  const names = new GuestNames(async (id) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return guest(id, 'An');
  });
  const pending = names.ensure(['g1']);
  names.clear();
  release();
  await pending;
  expect(names.get('g1')).toBeNull();
});

test('subscribers hear about new names; dispose silences them and stops further work', async () => {
  const fetchGuest = vi.fn(async (id: string) => guest(id, 'An'));
  const names = new GuestNames(fetchGuest);
  const listener = vi.fn();
  names.subscribe(listener);
  await names.ensure(['g1']);
  expect(listener).toHaveBeenCalled();
  names.dispose();
  listener.mockClear();
  await names.ensure(['g2']);
  expect(listener).not.toHaveBeenCalled();
  expect(fetchGuest).toHaveBeenCalledTimes(1);
});
