/**
 * HB-184 — đột biến 3× (NFR-PERF-03): tăng lên 600 VU trong 30 giây, giữ 5 phút, rồi hạ. Hỗn hợp hành vi
 * như KB-A. Ở chế độ suy giảm, hệ thống phải không sập và giữ 5xx < 1%. Ngưỡng độ trễ không áp ở đây.
 */
import { sleep } from 'k6';
import { fixture, get, pick, quote, randomStay, stayQuery } from './lib.js';

const PEAK = Number(__ENV.VUS || 600);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: PEAK },
        { duration: __ENV.DURATION || '5m', target: PEAK },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: { server_errors: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const roll = Math.random();
  const type = pick(fixture.roomTypes).id;
  if (roll < 0.5) get('/inventory/availability', { op: 'availability', query: stayQuery(type, randomStay()) });
  else if (roll < 0.7)
    get('/inventory/grid', {
      token: fixture.staff.reservation,
      op: 'grid',
      query: { propertyId: fixture.propertyId, from: fixture.window.from, to: fixture.window.grid },
    });
  else if (roll < 0.9) quote(pick(fixture.guests), type, randomStay());
  else get('/bookings', { token: fixture.staff.reservation, op: 'booking', query: { propertyId: fixture.propertyId } });
  sleep(0.5 + Math.random());
}
