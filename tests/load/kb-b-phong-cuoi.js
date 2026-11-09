/**
 * HB-184 KB-B — Giành một phòng cuối (TC-INV-03, NFR-REL-01, NFR-PERF-02 ghi tranh chấp, NFR-PERF-05).
 *
 * 200 VU, mỗi VU là một khách riêng, cùng nhắm đúng một đơn vị bán còn lại của đêm `LAST_NIGHT`
 * (bước chuẩn bị đã khoá mọi đơn vị khác). Trình tự: tra tồn → báo giá → chờ mốc chung (giây thứ 5) →
 * giữ chỗ cùng lúc. Kịch bản `ota` xen 20 webhook OTA đã ký trong lúc giành.
 *
 * Đạt khi:
 * - đúng **1** hold thắng; mọi lệnh khác là 409 nghiệp vụ, không 5xx;
 * - webhook p95 ≤ 300 ms.
 * `chay-cuc-bo.mjs` lặp lượt 5 lần, mỗi lượt một đêm mới, rồi chạy `bat-bien.sql` (BB-01: 0 bán trùng).
 */
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { fixture, get, otaWebhook, post, quote, stayQuery } from './lib.js';

const VUS = Number(__ENV.VUS || 200);
const night = fixture.lastRoom.nights[Number(__ENV.LAST_NIGHT || 0)];
const holdWon = new Counter('hold_won');
const holdLost = new Counter('hold_lost');
const holdOther = new Counter('hold_other');

export const options = {
  scenarios: {
    'kb-b': { executor: 'per-vu-iterations', vus: VUS, iterations: 1, maxDuration: '3m' },
    ota: {
      executor: 'shared-iterations',
      vus: 4,
      iterations: fixture.ota ? 20 : 0,
      startTime: '4s',
      maxDuration: '1m',
      exec: 'ota',
    },
  },
  thresholds: {
    hold_won: ['count==1'],
    hold_other: ['count==0'],
    'http_req_duration{op:hold}': ['p(95)<900'],
    'http_req_duration{op:ota}': ['p(95)<=300'],
    server_errors: ['rate==0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return { startAt: Date.now() + 5000 };
}

export default function (data) {
  const guest = fixture.guests[exec.vu.idInTest % fixture.guests.length];
  const type = fixture.lastRoom.roomTypeId;
  get('/inventory/availability', { op: 'availability', query: stayQuery(type, night) });
  const quoted = quote(guest, type, night);
  if (quoted.status !== 201) {
    holdOther.add(1, { reason: `quote-${quoted.status}` });
    return;
  }
  const wait = data.startAt - Date.now();
  if (wait > 0) sleep(wait / 1000);
  const hold = post(
    '/holds',
    { ...stayQuery(type, night), quoteId: quoted.json('quoteId') },
    { token: guest, op: 'hold' },
  );
  if (hold.status === 201) holdWon.add(1);
  else if (hold.status === 409) holdLost.add(1);
  else holdOther.add(1, { reason: `hold-${hold.status}` });
  check(hold, { 'hold 201|409': (r) => r.status === 201 || r.status === 409 });
}

export function ota() {
  const index = Number(__ENV.LAST_NIGHT || 0) * 100 + exec.scenario.iterationInTest;
  const response = otaWebhook(index, night);
  check(response, { 'ota 2xx': (r) => r.status >= 200 && r.status < 300 });
}
