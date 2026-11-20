---
id: HB-262
title: Đối soát tiền mặt theo người thu — kế toán chốt quỹ của lễ tân (`collectorId`) và xem tổng theo ngày (`GET /reconciliation/daily`)
risk: R2
owner: claude
max_lines: 650
allow:
  - packages/contracts/src/reconciliation.ts
  - packages/contracts/src/openapi/paths/f7.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/openapi.spec.ts
  - packages/api-client/src/front-office.ts
  - apps/api/src/modules/pay/reconciliation/**
  - apps/api/test/uc-chot-doi-soat-ngay/nguoi-thu.spec.ts
  - apps/api/test/rbac/routes/f5-pay.ts
  - docs/08-thi-cong/tickets/HB-262-doi-soat-theo-nguoi-thu.md
unlock:
  - docs/08-thi-cong/tickets/HB-262-doi-soat-theo-nguoi-thu.md
---

# HB-262 — Đối soát theo người thu

> Đặc tả do Claude soạn ngày 19/11/2026 khi dựng SCR-68 cho app vận hành.

## Vấn đề

- `POST /reconciliation/daily/close` (HB-150) chốt quỹ theo `(người thu, ngày VN)`, nhưng lấy **chính người gọi** làm người thu.
- Quyền chốt chỉ cấp cho ACCOUNTANT, để tách nhiệm vụ: lễ tân không tự chốt quỹ mình thu. Trong khi đó tiền mặt do lễ tân thu (`payments.created_by` là lễ tân).
- Kết quả: kế toán thật chốt thì luôn ra `expectedCash = 0`, mọi khoản lễ tân thu đều thành "thừa".
- Test HB-150 không bắt được lỗi vì cho **cùng một người dùng** đổi vai sang ACCOUNTANT rồi tự chốt.
- SCR-68 ("Xem tổng thu theo ngày VN, báo chênh lệch") cũng chưa có tuyến đọc nào.

## Thay đổi

1. Lệnh chốt nhận `collectorId` optional, mặc định là chính người gọi (tương thích HB-150).
   - Người thu phải là nhân viên có phạm vi ở cơ sở (OWNER toàn chuỗi); khác ⇒ 404.
   - Khoá dòng `users` của người thu.
   - Chặn chốt hai lần theo `after_json.collectorId`, không theo `actor_id` nữa. Bản ghi cũ vẫn khớp vì hai giá trị này trùng nhau.
   - Audit ghi người chốt là actor và người thu là `collectorId`.
2. `GET /reconciliation/daily?propertyId&businessDate`:
   - Trả theo từng người thu: số khoản tiền mặt, tiền mặt phải có (cùng phép tính sổ cái với lệnh chốt), và kết quả chốt nếu đã chốt.
   - Quyền `reconciliation.read` cấp cho FRONT_DESK, ACCOUNTANT, MANAGER, OWNER. Ai không có `reconciliation.readAll` (tức lễ tân) chỉ thấy dòng của mình.
   - Thuần đọc.
3. Hợp đồng, OpenAPI (126 path), `api-client.dailyReconciliation`, bảng đối chiếu RBAC.
4. Quyền chốt vẫn chỉ ACCOUNTANT, giữ nguyên tách nhiệm vụ.

## Tiêu chí nghiệm thu

1. `apps/api/test/uc-chot-doi-soat-ngay/nguoi-thu.spec.ts`:
   - Kế toán là người khác xem rồi chốt quỹ của lễ tân: `expectedCash` = tiền lễ tân thu; audit ghi đúng actor và người thu; chốt lần hai ⇒ 409.
   - Lễ tân chỉ thấy dòng của mình và không tự chốt được (403).
   - Người thu không tồn tại ⇒ 404; ngày sai dạng ⇒ 400.
2. `reconciliation.spec.ts` (HB-150) và `test/rbac` vẫn xanh.
3. `check:openapi` khớp bản commit; `check:contract` không có thay đổi phá vỡ.

## Ngoài phạm vi

- Màn SCR-68 trên app vận hành (HB-263).
- Màn đối soát của operations web (phiên frontend) có thể truyền `collectorId` để kế toán chọn người thu.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
