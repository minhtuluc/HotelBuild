/**
 * HB-184 KB-A — Tìm phòng (TC-INV-10, NFR-PERF-01/02/03, NFR-REL-02).
 *
 * Mỗi lượt của 200 VU chạy một trong các hành vi sau, trong 10 phút (`DURATION`):
 * - 70% tra tồn: `GET /inventory/availability` công khai, xen lưới tồn 30 ngày `GET /inventory/grid`;
 * - 20% báo giá `POST /quotes` (phiên khách);
 * - 10% tra booking (`GET /bookings` → `GET /bookings/{id}`, lễ tân đặt phòng);
 * - 1% giữ chỗ rồi bỏ dở thanh toán. Hold phải tự giải phóng ≤ 60 giây; `bat-bien.sql` kiểm sau lượt chạy.
 */
import { check, sleep } from 'k6';
import { fixture, get, pick, post, quote, randomStay, serverErrors, stayQuery } from './lib.js';

const DURATION = __ENV.DURATION || '10m';
const VUS = Number(__ENV.VUS || 200);

export const options = {
  scenarios: {
    'kb-a': {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    'http_req_duration{op:availability,expected_response:true}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{op:grid}': ['p(95)<800', 'p(99)<1500'],
    'http_req_duration{op:quote}': ['p(95)<400', 'p(99)<1000'],
    'http_req_duration{op:booking}': ['p(95)<400', 'p(99)<1000'],
    'http_req_duration{op:hold}': ['p(95)<900'],
    server_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const roomTypeId = () => pick(fixture.roomTypes).id;

function search() {
  const stay = randomStay();
  const response = get('/inventory/availability', {
    op: 'availability',
    query: stayQuery(roomTypeId(), stay),
  });
  check(response, { 'availability 200|429': (r) => r.status === 200 || r.status === 429 });
  if (Math.random() < 0.5) {
    const grid = get('/inventory/grid', {
      token: fixture.staff.reservation,
      op: 'grid',
      query: { propertyId: fixture.propertyId, from: fixture.window.from, to: fixture.window.grid },
    });
    check(grid, { 'grid 200': (r) => r.status === 200 });
  }
}

function priceCheck() {
  const response = quote(pick(fixture.guests), roomTypeId(), randomStay());
  check(response, { 'quote 201|409|422': (r) => [201, 409, 422].includes(r.status) });
}

function bookingLookup() {
  const token = fixture.staff.reservation;
  const list = get('/bookings', {
    token,
    op: 'booking',
    query: { propertyId: fixture.propertyId, limit: '20' },
  });
  check(list, { 'bookings 200': (r) => r.status === 200 });
  const rows = list.status === 200 ? (list.json('data') ?? []) : [];
  if (rows.length > 0) get(`/bookings/${pick(rows).id}`, { token, op: 'booking' });
}

function abandonedHold() {
  const guest = pick(fixture.guests);
  const stay = randomStay();
  const type = roomTypeId();
  const quoted = quote(guest, type, stay);
  if (quoted.status !== 201) return;
  const hold = post(
    '/holds',
    { ...stayQuery(type, stay), quoteId: quoted.json('quoteId') },
    { token: guest, op: 'hold' },
  );
  check(hold, { 'hold 201|409': (r) => r.status === 201 || r.status === 409 });
}

export default function () {
  const roll = Math.random();
  if (roll < 0.01) abandonedHold();
  else if (roll < 0.7) search();
  else if (roll < 0.9) priceCheck();
  else bookingLookup();
  sleep(0.5 + Math.random());
}

export { serverErrors };
