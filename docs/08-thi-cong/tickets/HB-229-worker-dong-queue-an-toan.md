---
id: HB-229
title: Worker không sập khi đóng Queue ngắn hạn lúc kết nối còn khởi tạo (hold hết hạn bị bỏ lại, P1)
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/worker/src/bullmq.factory.ts
  - apps/worker/src/jobs/alerts/alerts.job.ts
  - apps/worker/src/jobs/channel-sync/attempts.ts
  - apps/worker/test/queue-close-race.integration.spec.ts
  - docs/08-thi-cong/tickets/HB-229-worker-dong-queue-an-toan.md
---

# HB-229 — Đóng Queue an toàn trong worker

## Vấn đề (P1)

Hai lượt k6 HB-184 đầy đủ (09/11/2026) đều có worker thoát mã 1 giữa lượt. Hệ quả: bất biến NFR-REL-02 đỏ, với 175 rồi 543 hold đã hết hạn quá 60 giây mà không được giải phóng, vì không còn tiến trình nào quét `q.hold-expiry`.

Stderr của worker:

```
Error: Connection is closed.
Emitted 'error' event on RedisConnection instance at: bullmq/dist/cjs/classes/redis-connection.js:87
```

## Nguyên nhân gốc

Lỗi nằm trong BullMQ 5.81.5. `RedisConnection.close()` khi `status === 'initializing'` làm theo thứ tự:

1. `disconnect()` client;
2. `removeAllListeners()`;
3. lệnh `INFO` (kiểm phiên bản) đang bay bị reject;
4. handler `initializing.catch(err => this.emit('error', err))` của constructor phát `error` khi không còn listener ⇒ uncaught exception.

Worker có hai chỗ tạo `Queue` ngắn hạn rồi đóng:

- `alerts.job.ts`: đóng ngay khi mọi cảnh báo bị dedup chặn, không có lệnh `add` nào;
- `channel-sync/attempts.ts`.

Dưới tải, bước khởi tạo kết nối chậm nên lần đóng rơi đúng vào khe này.

Tái hiện độc lập: mở 50 `Queue` đồng thời, đóng sau 40–50 ms, không gọi `add` ⇒ tiến trình thoát mã 1 với đúng stack trên.

## Thay đổi

Thêm `closeQueueSafely(queue)` trong `bullmq.factory.ts`: chờ `waitUntilReady()` (bỏ qua lỗi kết nối, vì lỗi đó đã đi qua listener `error` của queue) rồi mới `close()`. Dùng hàm này ở hai chỗ tạo queue ngắn hạn. Các queue/worker sống dài (`bullmqConstructors`) chỉ đóng khi tắt worker, không đổi.

## Tiêu chí nghiệm thu

1. Mở 50 queue đồng thời, đóng ở 10 mốc 20–79 ms ⇒ không có lỗi uncaught. Test: `apps/worker/test/queue-close-race.integration.spec.ts::HB229_closing_short_lived_queues_during_init_does_not_crash`.
   - Code cũ: "Unhandled Errors: Connection is closed" ở 3/3 lượt, vitest exit 1.
   - Bản sửa: sạch 3/3 lượt.
2. Toàn bộ test worker xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · worker integration.
