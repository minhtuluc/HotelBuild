/**
 * HB-196 — đồng hồ nghiệp vụ điều khiển được cho tiến trình API **thật** (không sửa mã sản phẩm).
 *
 * `SystemClock` của API gọi `new Date()`; QA cần dựng các mốc 09:00 / 13:00 / 15:00 / 19:00 / 00:30 (BR-FO-02…04)
 * trên cùng một lượt chạy. Module này được nạp bằng `node --import` và cộng một độ lệch (ms) vào `Date.now()`
 * / `new Date()`. Độ lệch đọc lại từ tệp `QA_CLOCK_FILE` mỗi khi tệp đổi (thăm dò 25 ms).
 *
 * Không đổi được: `clock_timestamp()`/`now()` của PostgreSQL (vẫn là giờ thật) — các cột như `checked_in_at`
 * ghi giờ máy chủ CSDL theo ADR-014 nên script chỉ kiểm quyết định theo `CLOCK` (ngày/giờ VN), không kiểm các cột đó.
 */
import { readFileSync, watchFile } from 'node:fs';

const RealDate = Date;
let offsetMs = 0;
const file = process.env.QA_CLOCK_FILE;
function reload() {
  if (!file) return;
  try {
    offsetMs = Number(readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    /* giữ độ lệch cũ */
  }
}
reload();
// Không dùng tín hiệu: `enableShutdownHooks([])` của Nest bắt mọi tín hiệu (kể cả SIGUSR2) và tắt API.
if (file) watchFile(file, { interval: 25 }, reload).unref();

globalThis.Date = new Proxy(RealDate, {
  construct(target, args, newTarget) {
    if (args.length === 0) return new target(target.now() + offsetMs);
    return Reflect.construct(target, args, newTarget);
  },
  apply(target) {
    return new target(target.now() + offsetMs).toString();
  },
  get(target, prop, receiver) {
    if (prop === 'now') return () => target.now() + offsetMs;
    return Reflect.get(target, prop, receiver);
  },
});
