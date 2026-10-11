/** HB-030: hợp đồng F2 qua HTTP thật (PROP/INV/SYS). */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../src/client.js';
import { createInventoryApi, createPropertyApi, createSystemApi } from '../src/f2.js';

interface Recorded {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  bodyText: string;
}

interface Outcome {
  status: number;
  body?: unknown;
}

const requests: Recorded[] = [];
let handler: (request: Recorded) => Outcome;

const PROPERTY = {
  id: 'p1',
  name: 'Pine Hill Đà Lạt',
  status: 'ACTIVE',
  activeRoomCount: 20,
  overbookLimitPct: 5,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  version: 3,
};

const ROOM_TYPE = {
  id: 'rt1',
  propertyId: 'p1',
  code: 'DLX',
  capacityAdults: 2,
  capacityChildren: 1,
  basePrice: 900_000,
  minPrice: 700_000,
  maxPrice: 1_400_000,
  allowShared: false,
  bedCount: 1,
  version: 1,
};

const OPERATION = { operationId: 'op1', status: 'PENDING', statusUrl: '/api/v1/operations/op1' };

const ROUTES: Record<string, (request: Recorded) => Outcome> = {
  'GET /api/v1/properties': () => ({
    status: 200,
    body: { data: [PROPERTY], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'PATCH /api/v1/properties/p1': () => ({ status: 200, body: PROPERTY }),
  'POST /api/v1/room-types': () => ({ status: 201, body: ROOM_TYPE }),
  'GET /api/v1/room-types?propertyId=p1': () => ({
    status: 200,
    body: { data: [ROOM_TYPE], meta: { limit: 20, nextCursor: null, hasMore: false, total: 1 } },
  }),
  'GET /api/v1/inventory/grid?propertyId=p1&from=2026-11-01&to=2026-11-03': () => ({
    status: 200,
    body: {
      propertyId: 'p1',
      roomTypeId: 'rt1',
      from: '2026-11-01',
      to: '2026-11-03',
      cells: [
        { date: '2026-11-01', supply: 20, demand: 15, pool: 5, blocked: 0 },
        { date: '2026-11-02', supply: 20, demand: 20, pool: 0, blocked: 0 },
      ],
    },
  }),
  'PUT /api/v1/channel-allotments': () => ({ status: 204 }),
  'GET /api/v1/audit-logs?entityType=Booking': () => ({
    status: 200,
    body: {
      data: [
        {
          id: 'a1',
          actorId: 'u1',
          action: 'BOOKING_CANCELLED',
          entityType: 'Booking',
          entityId: 'b1',
          reason: 'Khách yêu cầu',
          beforeJson: null,
          afterJson: null,
          createdAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      meta: { limit: 50, nextCursor: null, hasMore: false, total: 1 },
    },
  }),
  'PUT /api/v1/system-settings/rate.floorPct': () => ({ status: 204 }),
  'POST /api/v1/system/backups': () => ({ status: 202, body: OPERATION }),
  'GET /api/v1/operations/op1': () => ({
    status: 200,
    body: { operationId: 'op1', status: 'RUNNING' },
  }),
};

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = Promise.withResolvers<void>();
      request.on('end', done.resolve);
      await done.promise;
      const recorded: Recorded = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      };
      const outcome = handler(recorded);
      requests.push(recorded);
      response.writeHead(outcome.status, { 'content-type': 'application/json' });
      response.end(outcome.body === undefined ? '' : JSON.stringify(outcome.body));
    })();
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('không lấy được cổng fixture');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
});

afterAll(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
});

beforeEach(() => {
  requests.length = 0;
  handler = (request) =>
    ROUTES[`${request.method} ${request.url}`]?.(request) ?? { status: 200, body: {} };
});

function client(): ApiClient {
  return new ApiClient({
    baseUrl,
    fetchImpl: fetch,
    sleep: async () => undefined,
    getAccessToken: () => 'access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
}

function recorded(index: number): Recorded {
  const item = requests.at(index);
  if (item === undefined) throw new Error(`chưa nhận yêu cầu thứ ${index}`);
  return item;
}

describe('hợp đồng F2 qua HTTP thật', () => {
  it('GET /properties trả bao hình danh sách', async () => {
    const page = await createPropertyApi(client()).list();
    expect(page.data.meta.total).toBe(1);
    expect(page.data.data[0]?.overbookLimitPct).toBe(5);
    expect(recorded(0).headers.authorization).toBe(
      'Bearer access-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('PATCH /properties/{id} gửi If-Match và thân đã parse', async () => {
    const updated = await createPropertyApi(client()).update('p1', { overbookLimitPct: 8 }, '"3"');
    expect(updated.data.version).toBe(3);
    const seen = recorded(0);
    expect(seen.method).toBe('PATCH');
    expect(seen.headers['if-match']).toBe('"3"');
    expect(seen.bodyText).toBe('{"overbookLimitPct":8}');
  });

  it('POST /room-types trả 201 và giữ tiền là số nguyên', async () => {
    const created = await createPropertyApi(client()).createRoomType({
      propertyId: 'p1',
      code: 'DLX',
      capacityAdults: 2,
      capacityChildren: 1,
      basePrice: 900_000,
      minPrice: 700_000,
      maxPrice: 1_400_000,
      allowShared: false,
    });
    expect(created.status).toBe(201);
    expect(created.data.basePrice).toBe(900_000);
  });

  it('GET /room-types lọc theo cơ sở và trả sàn–trần nguyên VND (HB-037)', async () => {
    const page = await createPropertyApi(client()).listRoomTypes({ propertyId: 'p1' });
    expect(page.data.meta.total).toBe(1);
    const roomType = page.data.data[0];
    expect(roomType?.minPrice).toBe(700_000);
    expect(roomType?.maxPrice).toBe(1_400_000);
    expect(recorded(0).url).toBe('/api/v1/room-types?propertyId=p1');
  });

  it('GET /inventory/grid gửi đủ tham số ngày và giải mã ô tồn', async () => {
    const grid = await createInventoryApi(client()).grid({
      propertyId: 'p1',
      from: '2026-11-01',
      to: '2026-11-03',
    });
    expect(grid.data.cells).toHaveLength(2);
    expect(recorded(0).url).toContain('from=2026-11-01');
  });

  it('grid forwards channelCode and preserves all property types with published channel inventory', async () => {
    const cell = {
      date: '2026-11-01',
      supply: 2,
      demand: 1,
      pool: 1,
      blocked: 0,
      published: 1,
      channelAvailable: 0,
    };
    const primary = {
      propertyId: 'p1',
      roomTypeId: 'rt1',
      from: cell.date,
      to: cell.date,
      cells: [cell],
    };
    const body = { ...primary, grids: [primary, { ...primary, roomTypeId: 'rt2' }] };
    handler = () => ({ status: 200, body });
    const grid = await createInventoryApi(client()).grid({
      propertyId: 'p1',
      from: cell.date,
      to: cell.date,
      channelCode: 'OTA_BOOKING',
    });
    expect(recorded(0).url).toContain('channelCode=OTA_BOOKING');
    expect(grid.data).toEqual(body);
  });

  it('PUT /channel-allotments gửi lô trong một yêu cầu kèm If-Match', async () => {
    await createInventoryApi(client()).putAllotments(
      {
        channelId: 'c1',
        roomTypeId: 'rt1',
        items: [
          { date: '2026-11-01', allotment: 5 },
          { date: '2026-11-02', allotment: 6 },
        ],
      },
      '"7"',
    );
    const seen = recorded(0);
    expect(seen.headers['if-match']).toBe('"7"');
    expect(seen.bodyText).toContain('"date":"2026-11-02"');
  });

  it('audit-logs và system-settings đi đúng tuyến', async () => {
    const system = createSystemApi(client());
    const logs = await system.listAuditLogs({ entityType: 'Booking' });
    expect(logs.data.data[0]?.action).toBe('BOOKING_CANCELLED');
    await system.updateSetting('rate.floorPct', { value: '60', reason: 'Chốt sàn mới' }, '"2"');
    expect(recorded(1).url).toBe('/api/v1/system-settings/rate.floorPct');
    expect(recorded(1).headers['if-match']).toBe('"2"');
  });

  it('sao lưu trả 202 kèm tham chiếu tác vụ; theo dõi operation đọc được trạng thái', async () => {
    const system = createSystemApi(client());
    const backup = await system.requestBackup({ mode: 'PITR' });
    expect(backup.status).toBe(202);
    expect(backup.data.statusUrl).toBe('/api/v1/operations/op1');
    const operation = await system.operation('op1');
    expect(operation.data.status).toBe('RUNNING');
  });
});

describe('HB033 additive property commands', () => {
  it('PATCH room type forwards version, reason and decodes updated price', async () => {
    handler = () => ({ status: 200, body: ROOM_TYPE });
    const result = await createPropertyApi(client()).updateRoomType(
      'rt1',
      { basePrice: 900000, reason: 'Synthetic' },
      '"2"',
    );
    expect(result.data.basePrice).toBe(900000);
    expect(recorded(0).method).toBe('PATCH');
    expect(recorded(0).url).toBe('/api/v1/room-types/rt1');
    expect(recorded(0).headers['if-match']).toBe('"2"');
    expect(recorded(0).headers['idempotency-key']).toBeTruthy();
  });
  it('POST room decodes published room DTO over real HTTP', async () => {
    handler = () => ({
      status: 201,
      body: {
        id: 'r1',
        propertyId: 'p1',
        roomTypeId: 'rt1',
        code: 'CS01-901',
        floor: 9,
        status: 'ACTIVE',
        connectingRoomId: null,
        version: 1,
      },
    });
    const result = await createPropertyApi(client()).createRoom({
      propertyId: 'p1',
      roomTypeId: 'rt1',
      code: 'CS01-901',
      floor: 9,
    });
    expect(result.status).toBe(201);
    expect(recorded(0).url).toBe('/api/v1/rooms');
    expect(recorded(0).headers['idempotency-key']).toBeTruthy();
  });
  it('PATCH room keeps original version header and sanitization authority on server', async () => {
    handler = () => ({
      status: 200,
      body: {
        id: 'r1',
        propertyId: 'p1',
        roomTypeId: 'rt1',
        code: 'CS01-901',
        floor: 9,
        status: 'ACTIVE',
        connectingRoomId: null,
        version: 2,
      },
    });
    await createPropertyApi(client()).updateRoom('r1', { floor: 9, note: 'Synthetic' }, '"1"');
    expect(recorded(0).method).toBe('PATCH');
    expect(recorded(0).headers['if-match']).toBe('"1"');
    expect(JSON.parse(recorded(0).bodyText)).toEqual({ floor: 9, note: 'Synthetic' });
  });
});
