/**
 * HB-184 KB-C — Đối soát báo cáo (TC-REP-04, NFR-PERF-04 báo cáo 90 ngày, NFR-PERF-02).
 *
 * Trong 10 phút (`DURATION`), hai nhóm chạy song song:
 * - 150 VU mở báo cáo 90 ngày: công suất, ADR/RevPAR (MANAGER), doanh thu theo kênh, huỷ (ACCOUNTANT);
 * - 50 VU thao tác thường: lưới tồn, tra booking, báo giá.
 */
import { check, sleep } from 'k6';
import { fixture, get, pick, quote, randomStay } from './lib.js';

const DURATION = __ENV.DURATION || '10m';
const scale = Number(__ENV.VUS || 200) / 200;

export const options = {
  scenarios: {
    reports: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.round(150 * scale)),
      duration: DURATION,
      exec: 'reports',
    },
    ops: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.round(50 * scale)),
      duration: DURATION,
      exec: 'ops',
    },
  },
  thresholds: {
    'http_req_duration{op:report}': ['p(95)<3000'],
    'http_req_duration{op:grid}': ['p(95)<800'],
    'http_req_duration{op:booking}': ['p(95)<400'],
    'http_req_duration{op:quote}': ['p(95)<400'],
    server_errors: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const REPORTS = [
  ['/reports/occupancy', 'manager', { groupBy: 'DAY' }],
  ['/reports/adr-revpar', 'manager', { groupBy: 'ROOM_TYPE' }],
  ['/reports/revenue-by-channel', 'accountant', {}],
  ['/reports/cancellations', 'accountant', {}],
];

export function reports() {
  const [path, role, extra] = pick(REPORTS);
  const response = get(path, {
    token: fixture.staff[role],
    op: 'report',
    query: { propertyId: fixture.propertyId, from: fixture.report.from, to: fixture.report.to, ...extra },
  });
  check(response, { 'report 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);
}

export function ops() {
  const roll = Math.random();
  if (roll < 0.4) {
    get('/inventory/grid', {
      token: fixture.staff.reservation,
      op: 'grid',
      query: { propertyId: fixture.propertyId, from: fixture.window.from, to: fixture.window.grid },
    });
  } else if (roll < 0.7) {
    get('/bookings', {
      token: fixture.staff.reservation,
      op: 'booking',
      query: { propertyId: fixture.propertyId, limit: '20' },
    });
  } else {
    quote(pick(fixture.guests), pick(fixture.roomTypes).id, randomStay());
  }
  sleep(0.5 + Math.random());
}
