/**
 * HB-227 — bộ mô phỏng OTA HB-128 nhận tuỳ chọn `booking` (mã cơ sở/loại phòng/kỳ/số tiền) để chạy
 * trên dữ liệu thật. QA HB-194 (QA-F6-01): payload cứng `H029-A` + số tiền ngẫu nhiên nên trên dữ liệu
 * thật cả 20 sự kiện vào DEAD_LETTER `OTA_PROPERTY_UNMAPPED`. Bỏ trống `booking` ⇒ payload phase A
 * không đổi (test khoá `simulator.locked.spec.ts`).
 *
 * Không cần CSDL: một máy nhận HTTP cục bộ ghi lại raw body, chữ ký vẫn đúng trên raw đã đổi.
 */
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { z } from 'zod';
import { runSimulator } from '../../../../scripts/simulators/ota/simulator.js';

interface Captured {
  readonly raw: string;
  readonly signature: string;
}
const captured: Captured[] = [];
const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    captured.push({
      raw: Buffer.concat(chunks).toString('utf8'),
      signature: String(request.headers['x-pinehill-signature'] ?? ''),
    });
    response.writeHead(202, { 'content-type': 'application/json' }).end('{}');
  });
});
let baseUrl = '';

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Máy nhận không có cổng TCP');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Khoá HMAC tổng hợp dựng từ nhãn (không phải khoá thật, không để literal cạnh tên biến khoá).
const SECRET = createHash('sha256').update('hb227:simulator-booking').digest('hex');
const accounts = ['booking', 'agoda', 'airbnb'].map((provider) => ({
  provider,
  keyId: `${provider}-k1`,
  accountId: `${provider}-acc`,
  secret: SECRET,
}));
const payloadSchema = z.object({
  propertyCode: z.string(),
  roomTypeCode: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  amount: z.number(),
});
const clock = new Date('2026-11-09T01:00:00Z');

function verified(item: Captured): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(item.signature);
  if (match === null) return false;
  const digest = createHmac('sha256', SECRET).update(`${match[1]}.${item.raw}`).digest('hex');
  return digest === match[2];
}

test('HB227_booking_override_reaches_every_signed_payload', async () => {
  captured.length = 0;
  const report = await runSimulator({
    baseUrl,
    clock,
    seed: 227,
    scenario: 'twenty-events',
    accounts,
    booking: {
      propertyCode: 'CS-01',
      roomTypeCode: 'DLX',
      checkIn: '2026-12-26',
      checkOut: '2026-12-27',
      amount: 1_788_000,
    },
  });
  expect(report.sent).toBe(20);
  expect(captured).toHaveLength(20);
  for (const item of captured) {
    expect(payloadSchema.parse(JSON.parse(item.raw))).toEqual({
      propertyCode: 'CS-01',
      roomTypeCode: 'DLX',
      checkIn: '2026-12-26',
      checkOut: '2026-12-27',
      amount: 1_788_000,
    });
    expect(verified(item)).toBe(true);
  }
});

test('HB227_without_override_payload_stays_phase_a', async () => {
  captured.length = 0;
  await runSimulator({ baseUrl, clock, seed: 227, scenario: 'twenty-events', accounts });
  const first = payloadSchema.parse(JSON.parse(captured[0]!.raw));
  expect(first).toMatchObject({
    propertyCode: 'H029-A',
    roomTypeCode: 'STD',
    checkIn: '2026-12-10',
    checkOut: '2026-12-12',
  });
  const amounts = captured.map((item) => payloadSchema.parse(JSON.parse(item.raw)).amount);
  expect(new Set(amounts).size).toBeGreaterThan(1);
});
