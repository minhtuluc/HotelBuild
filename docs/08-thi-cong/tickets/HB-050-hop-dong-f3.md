---
id: HB-050
title: Hợp đồng F3 — lịch giá, mùa, kênh, khuyến mãi, báo giá đa kênh, gói giá, chính sách huỷ
risk: R2
owner: deepseek
max_lines: 800
allow:
  - packages/contracts/src/**
  - packages/contracts/test/**
  - packages/contracts/openapi.json
  - packages/api-client/src/**
  - packages/api-client/test/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-web/test/**
  - packages/ui-native/src/stateMessages.ts
  - packages/ui-native/test/**
unlock:
  - docs/04-thiet-ke/api.md
---

# HB-050 — Hợp đồng F3

## Mục tiêu

`packages/contracts` mô tả đủ endpoint cấu hình giá và chính sách để HB-054…HB-057 và SCR-26…30, SCR-70 làm song song. HB-050 là **chủ duy nhất** của hợp đồng `rate-plans` (F4 dùng lại).

## Căn cứ

- [api.md](../../04-thiet-ke/api.md) §2.4 RATE: `GET/PUT /room-types/{roomTypeId}/rate-calendar`, `POST /seasons`, `PATCH /channels/{channelId}`, `POST /promotions`, `POST /quotes/multi-channel`, `GET /rate-plans`, `PUT /rate-plans/{ratePlanId}`, `GET /cancellation-policies`, `PUT /cancellation-policies/{policyId}`; §2.14. `POST /quotes` thuộc HB-070
- FR-RATE-01…13, FR-RATE-17, FR-RATE-19; UC-RATE-01…06; BR-RATE-16, BR-RATE-20, BR-RBAC-04; ADR-015
- [csdl](../../04-thiet-ke/csdl.md) §3 (`rate_calendars`, `seasons`, `channels`, `channel_property_settings`, `promotions`, `rate_plans`, `cancellation_policies`, `cancellation_tiers`)

## Tiêu chí nghiệm thu

1. Schema trong `src/rate.ts`, `src/cancellation-policy.ts`; path trong `src/openapi/paths/f3.ts`, `registry.ts` chỉ thêm một dòng. Request `strictObject`, response `object`; tiền số nguyên VND; hệ số là số thập phân có giới hạn (ghi rõ min/max theo tài liệu).
2. Endpoint ghi có `If-Match` (rate-plans, cancellation-policies, channels) và `reason` khi tài liệu yêu cầu; thay đổi giá vượt ±20% có trường xác nhận của OWNER theo BR-RBAC-04.
3. `PUT /cancellation-policies/{policyId}` nhận **toàn bộ** danh sách bậc; schema chặn ở mức hình thức (phần trăm 0–100, mốc giờ ≥ 0); validate nghiệp vụ (trùng mốc, thiếu catch-all) để backend trả `E_RATE_CONFIGURATION_INVALID`.
4. `GET /rate-plans` cho khách không lộ cấu hình nội bộ (chỉ điều khoản hiển thị). Không có path ghi lên price snapshot (§2.14); có test khẳng định.
5. Mã lỗi `E_RATE_CONFIGURATION_INVALID`, `E_RATE_BELOW_FLOOR`, `E_RATE_PROMO_INVALID`, `E_RATE_QUOTE_MISMATCH` (đã có trong catalogue) gắn đúng response.
6. `openapi:generate`; `check:openapi` xanh; `check:contract` 0 phá vỡ. `api-client`: `createRateApi` trong file mới, test HTTP thật.
7. `pnpm run ci` + `npm run check:docs` xanh.

## Ngoài phạm vi

- Backend, màn hình, engine giá (HB-052).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check:docs`

## Ghi chú cho người làm

Chạy song song được với HB-030 và HB-012 (cùng sửa `packages/contracts`). Ai merge sau thì rebase, giữ thay đổi của cả hai ở file dùng chung và **sinh lại** `openapi.json`.
