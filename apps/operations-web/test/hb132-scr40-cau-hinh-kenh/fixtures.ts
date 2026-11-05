import { vi } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import type { ChannelMappingsView, SalesClosureView } from '@pinehill/contracts';
import { ConfigController } from '../../src/features/hb132-scr40-cau-hinh-kenh/controller';
import type { MappingDraft } from '../../src/features/hb132-scr40-cau-hinh-kenh/model';
import type {
  Actor,
  ClosureIntent,
  ConfigData,
  ConfigPorts,
  MappingIntent,
  Selection,
} from '../../src/features/hb132-scr40-cau-hinh-kenh/port';

export const SELECTION = {
  propertyId: null,
  channelId: null,
  roomTypeId: null,
  range: { from: '2026-11-10', to: '2026-11-12' },
};

export function dataWith(overrides: { pct?: number; units?: number | undefined } = {}): ConfigData {
  return {
    properties: [
      {
        id: 'p1',
        name: 'Synthetic Hill',
        status: 'ACTIVE',
        activeRoomCount: 20,
        overbookLimitPct: overrides.pct ?? 5,
        checkInTime: '14:00',
        checkOutTime: '12:00',
        version: 1,
      },
    ],
    channels: [
      {
        id: 'c1',
        code: 'OTA_BOOKING',
        name: 'Synthetic OTA',
        multiplier: 1,
        commissionPct: 15,
        holdMinutes: 30,
        overbookAllowed: true,
        version: 1,
      },
    ],
    roomTypes: [
      {
        id: 'rt1',
        propertyId: 'p1',
        code: 'DOR',
        capacityAdults: 1,
        capacityChildren: 0,
        basePrice: 100000,
        minPrice: 100000,
        maxPrice: 100000,
        allowShared: true,
        bedCount: 6,
        ...(overrides.units === undefined && 'units' in overrides
          ? {}
          : { sellingUnits: overrides.units ?? 6 }),
        version: 1,
      },
    ],
    selection: { ...SELECTION, propertyId: 'p1', channelId: 'c1', roomTypeId: 'rt1' },
    rows: [
      { date: '2026-11-10', allotment: 3, used: 1 },
      { date: '2026-11-11', allotment: 4, used: 2 },
    ],
  };
}

export const OWNER: Actor = { userId: 'u1', role: 'OWNER', propertyScope: ['p1'] };
export const MANAGER: Actor = { userId: 'u2', role: 'MANAGER', propertyScope: ['p1'] };
export const DESK: Actor = { userId: 'u3', role: 'FRONT_DESK', propertyScope: ['p1'] };

export const mappingView = (version: number): ChannelMappingsView => ({
  channelId: 'c1',
  version,
  mapping: {
    id: 'm1',
    channelId: 'c1',
    roomTypeId: 'rt1',
    providerRoomTypeCode: 'OTA-DORM',
    allotmentPct: 40,
    externalRatePlanCode: null,
    status: 'ACTIVE',
    version,
    updatedAt: '2026-11-10T01:00:00.000Z',
  },
});

export const DRAFT: MappingDraft = {
  roomTypeId: 'rt1',
  providerRoomTypeCode: ' OTA-DORM ',
  allotmentPct: '40',
  externalRatePlanCode: '',
  status: 'ACTIVE',
};

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

export function setup(actor: Actor = OWNER, data: ConfigData = dataWith()) {
  const ports = {
    actor: vi.fn(async () => actor),
    load: vi.fn(async (_selection: Selection, _signal: AbortSignal) => data),
    putMapping: vi.fn(async (_intent: MappingIntent, _signal: AbortSignal) => ({
      view: mappingView(2),
      etag: '"2"',
    })),
    closeSales: vi.fn(
      async (_intent: ClosureIntent, _signal: AbortSignal): Promise<SalesClosureView> => ({
        channelId: 'c1',
        rows: [],
      }),
    ),
  } satisfies ConfigPorts;
  let time = Date.parse('2026-11-10T00:00:00Z');
  let sequence = 0;
  const controller = new ConfigController({
    ports,
    selection: SELECTION,
    newKey: () => `key-${(sequence += 1)}`,
    now: () => time,
  });
  return { ports, controller, advance: (ms: number) => (time += ms) };
}
