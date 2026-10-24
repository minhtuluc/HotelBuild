#!/usr/bin/env node
/**
 * HB-117 — QA F5 (tiền, huỷ/hoàn, đổi ngày, PSP, chi hoàn) trên **API thật** + worker thật + CSDL riêng + seed dev.
 * Đối chiếu số tiền/trạng thái với biểu thức và SQL **độc lập** viết từ `quy-tac-nghiep-vu.md`,
 * `chinh-sach-huy-hoan-coc.md` và `csdl.md` (không dùng lại engine `packages/domain` hay truy vấn trong `apps/**`).
 * Chữ ký PSP được dựng lại từ tài liệu giao thức (api.md §5.2), không import `pay/psp/*`.
 *
 * Cách chạy (PG16 + Redis7 dev đang chạy sẵn; Redis DB /10 của lát cắt này):
 *
 *   DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:5432/pinehill' \
 *   REDIS_URL='redis://127.0.0.1:6379/10' NODE_ENV=development \
 *   node tests/e2e/f5/qa-f5-money.mjs
 *
 * `PASS/FAIL` là kết luận của phép kiểm; `FINDING` là lệch mã ↔ BR/AC cần lead xem (không làm đỏ lượt chạy).
 * Đồng hồ nghiệp vụ của API điều khiển được (`tests/e2e/f7/clock-shim.mjs`); `clock_timestamp()` của PostgreSQL vẫn là giờ thật.
 */
import { randomUUID } from 'node:crypto';
import {
  API_BASE,
  api,
  bootstrap,
  check,
  dbInfo,
  eq,
  findings,
  finding,
  login,
  mintPin,
  results,
  setClock,
  sql,
  teardown,
  vn,
  wait,
} from './qa-f5-lib.mjs';
import { scenarioCancelTiers } from './sc-cancel.mjs';
import { scenarioPaidThenExpires, scenarioPsp } from './sc-psp.mjs';
import { scenarioPayout, scenarioRefundControls } from './sc-refund.mjs';
import { scenarioPartialCancel, scenarioReschedule } from './sc-partial.mjs';
import { ctx } from './qa-f5-ctx.mjs';

const section = (title) => console.log(`\n## ${title}`);

try {
  await bootstrap();
  await ctx.load();
  section('1. Huỷ theo bậc chính sách (TC-BOOK-23, TC-CANCEL, BR-CANCEL-01…06)');
  await scenarioCancelTiers(section);
  section('2. Callback PSP (TC-PAY-22, BR-PAY-03/05/11, api.md §5.2)');
  await scenarioPsp(section);
  await scenarioPaidThenExpires();
  section('3. Hoàn tiền: maker–checker, ngưỡng, hạn mức (TC-PAY-23, BR-CANCEL-15/17/18)');
  const refundCtx = await scenarioRefundControls();
  section('4. Chi hoàn qua /pay + worker thật (HB-100/HB-110; BR-PAY-08/09/11)');
  await scenarioPayout(refundCtx);
  section('5. Huỷ một phần booking nhiều phòng (TC-BOOK-26/27, BR-CANCEL-19)');
  await scenarioPartialCancel();
  section('6. Đổi ngày (BR-BOOK-12, BR-CANCEL-08, BR-RATE-16)');
  await scenarioReschedule();
} catch (error) {
  check('Script chạy hết không lỗi ngoài ý muốn', false, error instanceof Error ? error.stack : String(error));
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n# TỔNG: ${results.length - failed.length}/${results.length} PASS · ${failed.length} FAIL · ${findings.length} FINDING · CSDL ${dbInfo.name}`);
  if (findings.length) {
    console.log('\n## Phát hiện');
    for (const f of findings) console.log(`- ${f.id}: ${f.summary}\n  Bằng chứng: ${f.evidence}`);
  }
  await teardown();
}
