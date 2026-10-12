import { describe, expect, it } from 'vitest';
import { ApiError } from '@pinehill/api-client';
import { roomTypeSummarySchema, inventoryGridSchema } from '@pinehill/contracts';
import { projectDayBoard, defaultDay, validDay } from '../src/app/(ops)/day-board/model';
import { DayBoardController } from '../src/app/(ops)/day-board/controller';

const types = [
  roomTypeSummarySchema.parse({
    id: 'rt1',
    propertyId: 'p1',
    code: 'DOR',
    capacityAdults: 6,
    capacityChildren: 0,
    bedCount: 6,
    allowShared: true,
    basePrice: 200000,
    minPrice: 100000,
    maxPrice: 400000,
    version: 1,
  }),
];
const grid = () =>
  inventoryGridSchema.parse({
    propertyId: 'p1',
    roomTypeId: 'rt1',
    from: '2026-12-24',
    to: '2026-12-24',
    capturedAt: '2026-10-12T00:00:00.000Z',
    cells: [{ date: '2026-12-24', supply: 6, demand: 8, pool: -2, blocked: 0, published: 0 }],
  });
const data = () => ({
  properties: [{ id: 'p1', name: 'Synthetic property' }],
  ...projectDayBoard('p1', '2026-12-24', types, grid()),
});
describe('HB040 daily inventory projection', () => {
  it('invalid server capture date cannot crash the display formatter', () => {
    expect(() =>
      projectDayBoard('p1', '2026-12-24', types, { ...grid(), capturedAt: '2026-13-12T00:00:00Z' }),
    ).toThrow();
  });
  it('defaults day to VN and rejects impossible calendar days', () => {
    expect(defaultDay(new Date('2026-10-11T18:00:00Z'))).toBe('2026-10-12');
    expect(validDay('2026-02-30')).toBe(false);
    expect(validDay('2028-02-29')).toBe(true);
  });
  it('uses server published value, DOR bed units and server decision timestamp verbatim', () => {
    const actual = projectDayBoard('p1', '2026-12-24', types, grid());
    expect(actual.rows).toEqual([{ roomTypeId: 'rt1', code: 'DOR', unit: 'beds', available: 0 }]);
    expect(actual.capturedAt).toBe('2026-10-12T00:00:00.000Z');
  });
  it('does not fabricate timestamp or empty/missing cells as zero', () => {
    const missing = { ...grid(), capturedAt: undefined };
    expect(projectDayBoard('p1', '2026-12-24', types, missing).capturedAt).toBeNull();
    expect(() => projectDayBoard('p1', '2026-12-24', types, { ...grid(), cells: [] })).toThrow();
    expect(() =>
      projectDayBoard('p1', '2026-12-24', types, { ...grid(), propertyId: 'other' }),
    ).toThrow();
  });
  it('preserves server published projection instead of recalculating from pool', () => {
    const input = {
      ...grid(),
      cells: [{ date: '2026-12-24', supply: 10, demand: 2, pool: 8, blocked: 0, published: 3 }],
    };
    expect(projectDayBoard('p1', '2026-12-24', types, input).rows[0]?.available).toBe(3);
  });
  it('read failure retains current scoped data; 403 clears it', async () => {
    let failure: unknown;
    const controller = new DayBoardController(
      {
        load: async () => {
          if (failure) throw failure;
          return data();
        },
      },
      '2026-12-24',
    );
    await controller.load();
    failure = new ApiError({ kind: 'http', status: 500, message: 'synthetic' });
    await controller.load();
    expect(controller.state.data?.rows).toHaveLength(1);
    expect(controller.state.phase).toBe('error');
    failure = new ApiError({
      kind: 'http',
      status: 403,
      code: 'E_AUTH_OUT_OF_SCOPE',
      message: 'synthetic',
    });
    await controller.load();
    expect(controller.state.data).toBeNull();
    expect(controller.state.phase).toBe('forbidden');
  });
  it('property switch clears old data immediately and ignores late responses', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wait = false;
    const controller = new DayBoardController(
      {
        load: async () => {
          if (wait) await gate;
          return data();
        },
      },
      '2026-12-24',
    );
    await controller.load();
    wait = true;
    const late = controller.load();
    controller.selectProperty('p2');
    expect(controller.state.data).toBeNull();
    release?.();
    await late;
    expect(controller.state.data).toBeNull();
  });
  it('denial wins even if another request later resolves and unmount invalidates output', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = new DayBoardController(
      {
        load: async () => {
          await gate;
          return data();
        },
      },
      '2026-12-24',
    );
    const load = controller.load();
    controller.deny();
    release?.();
    await load;
    expect(controller.state.phase).toBe('forbidden');
    expect(controller.state.data).toBeNull();
  });
});
