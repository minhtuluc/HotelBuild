---
id: HB-236
title: API thật cho khuyến mãi — `GET`/`POST /promotions` (SCR-29, UC-RATE-04)
risk: R1
owner: claude
max_lines: 600
allow:
  - apps/api/src/modules/rate/promotions/**
  - apps/api/src/app.module.ts
  - apps/api/test/rate/calendar/promotions.spec.ts
  - apps/api/test/rbac/routes/f3-rate.ts
  - docs/04-thiet-ke/api.md
  - docs/08-thi-cong/tickets/HB-236-api-khuyen-mai.md
---

# HB-236 — API khuyến mãi

## Vấn đề

api.md §2.4, OpenAPI (`promotionsList`, `promotionsCreate`), `@pinehill/api-client` và màn SCR-29 (HB-061) đều đã có `GET`/`POST /promotions`. Nhưng `apps/api` **không có module nào** phục vụ hai tuyến này: SCR-29 chỉ chạy trên API giả của E2E. Engine giá (HB-052, HB-199) đọc bảng `promotions`, vậy mà trên hệ thống thật không ai tạo được khuyến mãi. Phát hiện khi rà nợ kỹ thuật (TD-08).

## Thay đổi

`modules/rate/promotions` theo cùng mẫu `seasons`:

- `GET`: MANAGER/OWNER; lọc `status`; phân trang cursor; `propertyId` chỉ để kiểm phạm vi, vì khuyến mãi áp toàn chuỗi, phạm vi theo kênh và **mã** loại phòng.
- `POST`: chỉ OWNER, `@Idempotent`, 201 rỗng; ghi audit `PROMOTION_CREATED` và outbox `RateChanged`.
- Luật (`422 E_RATE_PROMO_INVALID` kèm `details`):
  - `code` viết hoa, đúng định dạng, duy nhất;
  - PERCENT ≤ 100;
  - mã loại phòng thuộc STD/SUP/DLX/FAM/DOR, không trùng;
  - `validTo` ≥ `validFrom`.
- Ngày: thời điểm UTC của hợp đồng đổi về **ngày nghiệp vụ VN** để lưu (cột `date`, engine coi `valid_to` gồm cả ngày). Khi đọc: `validFrom` = 00:00 VN, `validTo` = 23:59:59.999 VN.
- Oracle RBAC cho hai tuyến mới.

## Tiêu chí nghiệm thu

1. OWNER tạo ⇒ hàng đúng (ngày VN), audit, outbox; MANAGER đọc thấy đúng hợp đồng. Test: `apps/api/test/rate/calendar/promotions.spec.ts::HB236_owner_creates_promotion_stored_as_vn_business_dates_with_audit_and_outbox`.
2. Vi phạm luật ⇒ 422 kèm đúng `field`/`issue`; trùng mã (không phân biệt hoa thường) ⇒ `DUPLICATE`. Test: `…::HB236_business_rules_rejected_with_promo_invalid_details`.
3. MANAGER tạo ⇒ 403; FRONT_DESK đọc ⇒ 403; cơ sở ngoài phạm vi ⇒ 403. Test: `…::HB236_roles_and_scope`.
4. Khuyến mãi tạo qua API được engine báo giá áp (tổng thấp hơn). Test: `…::HB236_promotion_created_via_api_is_applied_by_quote_engine`.
5. `test/rbac/**` xanh; `check:openapi`/`check:contract` không đổi.

## Ngoài phạm vi

Sửa/ngừng khuyến mãi (`PATCH`) chưa có trong hợp đồng. Ghi vào TD-08 (phần còn lại).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/{rate,quotes,rbac}`.
