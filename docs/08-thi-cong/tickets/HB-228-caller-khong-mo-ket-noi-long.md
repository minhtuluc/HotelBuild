---
id: HB-228
title: Tuyến khách `@Idempotent` không xin connection thứ hai trong transaction (bế tắc pool, P1)
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/api/src/modules/book/holds/principal.ts
  - apps/api/src/modules/book/bookings/principal.ts
  - apps/api/src/modules/rate/quotes/principal.ts
  - apps/api/test/holds/fixture.ts
  - apps/api/test/holds/pool-starvation.spec.ts
  - docs/08-thi-cong/tickets/HB-228-caller-khong-mo-ket-noi-long.md
---

# HB-228 — Không nhân đôi connection ở tuyến khách `@Idempotent`

## Vấn đề (P1)

Các tuyến `@Public` của khách sau đây đều có `@Idempotent`:

- `POST/DELETE /holds`;
- `POST /bookings`, `POST /bookings/{id}/confirm`;
- `POST /payments/online`;
- `POST /quotes` (`quotePrincipal`). Chỗ này được phát hiện ở lượt k6 đầy đủ: 200 VU ⇒ 500 hàng loạt ở `POST /quotes`.

Thứ tự chạy của chúng: `IdempotencyStore.run` mở transaction (giữ một connection, khoá hàng fence), rồi handler gọi `holdCaller(this.db, …)` / `bookingCaller(this.db, …)` để kiểm phiên (TD-59, `findUsableSession`). Bước kiểm phiên xin **thêm** một connection từ pool.

Khi số lệnh đồng thời ≥ kích thước pool, mọi connection đều bị transaction giữ, và mọi lệnh chờ connection thứ hai. Kết quả là bế tắc cho tới `timeout` 10 giây của transaction, rồi **mọi** lệnh trả 500.

Bằng chứng:

- Pool mặc định của Prisma trên máy dev là 8 × 2 + 1 = 17. Lượt k6 HB-184 với 20 VU giành phòng cuối: cả 20 lệnh trả 500 sau 10,08 s.
- Test mới (pool 4, 12 lệnh): trên code cũ cả 12 lệnh trả 500 sau 10,7 s, không hold nào được tạo.
- Đây là cơ chế thật phía sau TD-79 (PR #261 đo được "kiểm phiên thêm một lần lấy kết nối" nhưng quy về tải) và AC4 HB-076 đỏ chập chờn trên CI.

## Thay đổi

`holdCaller` / `bookingCaller` / `quotePrincipal` nhớ kết quả theo chính đối tượng `FastifyRequest` (`WeakMap`):

- Lần gọi đầu nằm trong `authorize` của access `@Idempotent`, chạy **trước** `claim`/`run`, nên còn ngoài transaction.
- Lần gọi lại trong handler dùng lại kết quả đó, không truy vấn thêm.

Ngữ nghĩa xác thực giữ nguyên: cùng một request được kiểm một lần, tại thời điểm cấp quyền. Tuyến GET không có `@Idempotent` (balance, trạng thái thanh toán) vẫn gọi một lần như cũ.

## Tiêu chí nghiệm thu

1. 12 lệnh `POST /holds` đồng thời trên pool 4 ⇒ không lệnh nào 5xx, đúng 1 lệnh `201`, còn lại 409 nghiệp vụ, xong dưới 8 giây. Test: `apps/api/test/holds/pool-starvation.spec.ts::HB228_concurrent_holds_beyond_pool_size_get_business_answers_not_timeouts`, đỏ trên code cũ.
2. 12 lệnh `POST /quotes` đồng thời trên pool 4 ⇒ cả 12 trả `201` dưới 8 giây. Test: `…::HB228_concurrent_quotes_beyond_pool_size_do_not_deadlock`. Trên code cũ: 12 × 500 sau 10,6 s.
3. Các bộ `quotes`, `rate`, `holds`, `bookings`, `huy-booking`, `psp-thanh-toan-truc-tuyen`, `thu-tien-tai-quay`, `webhook-psp`, `observability`, `rbac`, `idempotency` vẫn xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api`.
