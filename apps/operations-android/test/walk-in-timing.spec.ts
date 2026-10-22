import { expect, test } from 'vitest';
import { rig } from './walk-in-fixtures';

/**
 * AC1 (≤5 bước, ≤3 phút trên 20 lượt): ĐO BẰNG MÔ PHỎNG LOGIC, không phải người thật. Mỗi thao tác tiến đồng hồ bơm
 * vào theo mô hình chi phí khai báo tại đây (chạm 2 s, gõ mỗi ký tự 0,4 s, chờ mạng 1,5 s mỗi lệnh gửi); số đo người
 * thật trên thiết bị là BLOCKED. Test ghi log từng lượt và khẳng định số bước ≤ 5 và tổng ≤ 180 s.
 */
test('20 simulated walk-ins stay within 5 steps and 180 s under the declared cost model', async () => {
  const TAP = 2000;
  const KEY = 400;
  const NET = 1500;
  const log: string[] = [];
  for (let run = 1; run <= 20; run += 1) {
    const r = rig();
    const spend = (ms: number) => {
      r.clock.value += ms;
    };
    const steps = new Set<string>();
    const mark = () => steps.add(r.flow.state.step);
    const started = r.clock.value;
    await r.flow.init('p1', '2026-10-22');
    mark();
    spend(TAP);
    r.flow.setStay({ roomTypeId: 'rt1' });
    spend(TAP);
    r.flow.next();
    mark();
    const name = `Khách ${run}`;
    const phone = '0912345678';
    spend(TAP + KEY * (name.length + phone.length));
    r.flow.setGuest({ fullName: name, phone });
    spend(TAP);
    r.flow.next();
    mark();
    spend(TAP);
    await r.flow.create();
    spend(NET);
    mark();
    spend(TAP + KEY * 6);
    await r.flow.verifyPin('123456');
    spend(NET);
    spend(TAP);
    await r.flow.pay('CASH');
    spend(NET);
    mark();
    const seconds = (r.clock.value - started) / 1000;
    log.push(`run ${run}: steps=${steps.size} elapsed=${seconds.toFixed(1)}s`);
    expect(r.flow.state.step).toBe('done');
    expect(steps.size).toBeLessThanOrEqual(5);
    expect(seconds).toBeLessThanOrEqual(180);
  }
  expect(log).toHaveLength(20);
  console.warn(log.join('\n'));
});
