---
id: HB-055
title: UC + endpoint kênh (hệ số/hoa hồng/hold) và khuyến mãi
risk: R1
owner: deepseek
max_lines: 600
allow:
  - apps/api/src/modules/rate/channels/**
  - apps/api/src/modules/rate/promotions/**
  - apps/api/test/rate/channels/**
---

# HB-055 — Kênh và khuyến mãi

## Căn cứ

- api.md §2.4 (`PATCH /channels/{channelId}`, `POST /promotions`); FR-RATE-07…13; UC-RATE-03, UC-RATE-04; BR-RATE-07, BR-RATE-09, BR-RATE-10, BR-RATE-11, BR-RATE-13, BR-RATE-18; TC-RATE-10
- Hợp đồng `rate.ts` (HB-050); bảng `channels`, `channel_property_settings`, `promotions`
- Phụ thuộc chung: HB-013 (guard xác thực), HB-014 (`@Permission` + `modules/<mod>/permissions.ts`), HB-009 (`AuditWriter`), HB-018 (seed cho test)

## Tiêu chí nghiệm thu

1. `PATCH channels`: mặc định toàn chuỗi; ghi đè theo (kênh, cơ sở) bằng **dòng mới** `channel_property_settings` có `effective_from` (không sửa dòng cũ, để snapshot cũ truy được nguồn); If-Match; OWNER.
2. Cảnh báo giá thuần OTA thấp hơn WEB (sàn `1/(1−hoa hồng)`, BR-RATE-09/18) trả trong `warnings[]`; AGENCY miễn theo tài liệu.
3. `POST promotions`: validate type/value/khoảng hiệu lực/phạm vi; khuyến mãi làm giá chạm dưới sàn → `E_RATE_BELOW_FLOOR` khi cấu hình (BR-RATE-10); `E_RATE_PROMO_INVALID` cho cấu hình sai hình thức.
4. Sửa hệ số chỉ ảnh hưởng báo giá **mới**; test khẳng định báo giá đã chốt không đổi.
5. Audit; `pnpm run ci` + `pnpm test:integration` xanh.
