import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ChannelSummary, ListPage, OtaBooking } from '@pinehill/contracts';
import { OtaController } from '../../src/features/hb134-scr42-booking-ota/controller';
import type { Filter, Intent } from '../../src/features/hb134-scr42-booking-ota/model';
import type { Actor, OtaPorts } from '../../src/features/hb134-scr42-booking-ota/port';

export const OWNER: Actor = { userId: 'u1', role: 'OWNER', propertyScope: ['p1'] };
export const MANAGER: Actor = { userId: 'u2', role: 'MANAGER', propertyScope: ['p1'] };
export const ACCOUNTANT: Actor = { userId: 'u3', role: 'ACCOUNTANT', propertyScope: ['p1'] };

export const channel = (id: string): ChannelSummary => ({
  id,
  code: 'OTA_BOOKING',
  name: `Synthetic ${id}`,
  multiplier: 1,
  commissionPct: 15,
  holdMinutes: 30,
  overbookAllowed: false,
  version: 1,
});

export const booking = (id: string, overrides: Partial<OtaBooking> = {}): OtaBooking => ({
  id,
  channelId: 'c1',
  eventType: 'booking.created',
  providerEventId: `ev-${id}`,
  providerBookingCode: `OTA-${id}`,
  status: 'PROCESSED',
  bookingId: `bk-${id}`,
  duplicate: false,
  flagged: false,
  flagReason: null,
  flaggedBy: null,
  flaggedAt: null,
  oversold: false,
  guestNameMasked: 'N*** V*** A',
  receivedAt: '2026-11-10T00:00:00.000Z',
  processedAt: '2026-11-10T00:00:05.000Z',
  errorCode: null,
  version: 4,
  ...overrides,
});

export const page = (rows: OtaBooking[], next: string | null = null): ListPage<OtaBooking> => ({
  data: rows,
  meta: { limit: 20, nextCursor: next, hasMore: next !== null, total: rows.length },
});

export function http(
  status: number,
  code: string,
  extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) {
  return new ApiError({
    kind: 'http',
    status,
    code,
    message: 'PII Nguyen Van A',
    traceId: 'trace-1',
    ...extra,
  });
}

export function setup(actor: Actor = MANAGER) {
  const ports = {
    actor: vi.fn(async (_signal: AbortSignal) => actor),
    channels: vi.fn(async (_signal: AbortSignal) => [channel('c1'), channel('c2')]),
    list: vi.fn(
      async (_id: string, _filter: Filter, _cursor: string | undefined, _signal: AbortSignal) =>
        page([booking('b1'), booking('b2')]),
    ),
    flag: vi.fn(async (_intent: Intent, _signal: AbortSignal) =>
      booking('b1', { flagged: true, flagReason: 'Trùng mã', version: 5 }),
    ),
  } satisfies OtaPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new OtaController({
    ports,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
