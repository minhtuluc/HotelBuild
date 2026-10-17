---
id: HB-203
title: Làm hermetic hai ca log của worker (sink/logger dùng chung giữa các ca)
risk: R1
owner: deepseek
max_lines: 300
allow:
  - apps/worker/test/**
  - apps/worker/vitest.config.ts
---

# HB-203 — Hai ca log worker phải hermetic

> Ticket nhỏ do người thay vai lead cấp. Nguồn: cổng `pnpm run ci` của nhánh HB-200 (chỉ đổi trần thời gian, **không** đụng
> mã worker) đỏ ở `apps/worker test:coverage` với hai ca log — tức lỗi **không hermetic** có sẵn, không phải do nhánh đó.

## Bằng chứng đỏ (lượt chạy trên nhánh HB-200, Redis `/16`)

```
FAIL test/redis.integration.spec.ts > HB-078 TD-01 — … log qua logger đã cấu hình, không đưa nội dung lỗi thô vào log
AssertionError: expected [ {…}, …(6) ] to deeply equal [ {…}, …(3) ]      (test/redis-errors.ts:209)
+ extra records: context { queue: 'q.hold-expiry' | 'hb078-logger-<uuid>', component: 'queue'|'worker',
  errorCode: 'UNKNOWN' }, message 'BullMQ phát lỗi'

FAIL test/worker-log.integration.spec.ts > real Redis preserves private job content without putting it into receipt logs
AssertionError: expected [ …(24) ] to deeply equal [ ObjectContaining{…} ]
```

Hai ca **so sánh toàn bộ mảng** record log, nhưng các ca khác trong cùng tệp vẫn còn hàng đợi/worker sống và còn bắn sự kiện
`error` sang cửa sổ thu log của ca đang chạy ⇒ đỏ phụ thuộc **thời điểm**, không phải hành vi sản phẩm sai.

## Tiêu chí nghiệm thu

1. **Tái hiện trước khi sửa**: chạy lặp (ví dụ 10 lượt `vitest run test/redis.integration.spec.ts test/worker-log.integration.spec.ts`)
   hoặc dưới tải, dán log cho thấy ít nhất một lượt đỏ đúng kiểu trên.
2. **Sửa gốc**, không nới khẳng định: mỗi ca có **sink/logger riêng** và **đóng/await** mọi hàng đợi–worker nó tạo trước khi
   ca kế tiếp chạy; hoặc khẳng định trên **tập đã lọc theo hàng đợi của chính ca** (nhưng vẫn giữ nguyên các bất biến an toàn:
   không lộ nội dung lỗi thô/PII trong log). Không `skip`, không nới/đổi kỳ vọng an toàn.
3. **Chứng minh sau khi sửa**: 10 lượt liên tiếp (hoặc dưới tải) **xanh 10/10**, dán output; và `pnpm --filter @pinehill/worker test:coverage` **exit 0** (trần bao phủ giữ nguyên).
4. `pnpm run ci` xanh trên nhánh; `pnpm check:scope` đạt.

## Ranh giới

- Chỉ sửa **test** của worker (và config nếu cần, ví dụ `fileParallelism`/`sequence`) — **không** sửa `apps/worker/src/**`,
  không sửa `packages/**`, không đổi trần bao phủ.
- Nếu hoá ra lỗi **sản phẩm** (logger rò nội dung lỗi thô), **dừng và báo** — đây là bất biến an toàn (NFR-SEC-04).
