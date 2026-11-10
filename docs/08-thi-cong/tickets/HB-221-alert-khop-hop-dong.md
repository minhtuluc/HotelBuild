---
id: HB-221
title: Cảnh báo quá tải cho lễ tân khớp hợp đồng — SCR-67 Android đọc được trên API thật
risk: R1
owner: claude
max_lines: 450
allow:
  - apps/api/src/modules/over/queries/service.ts
  - apps/api/test/over/read-contract.spec.ts
  - packages/contracts/src/overbooking.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/f6/**
  - packages/api-client/test/f6/**
  - apps/operations-android/src/features/f6-overbooking/**
  - apps/operations-android/test/f6-overbooking/**
  - docs/04-thiet-ke/api.md
---

# HB-221 — Cảnh báo quá tải cho lễ tân khớp hợp đồng

## Mục tiêu

`GET /overbooking-alerts` (FRONT_DESK, SCR-67 operations Android) trả đúng hình dạng hợp đồng công bố để client decode được trên API thật. Phần tiếp theo của HB-220 (QA HB-194, QA-F6-07/08 cùng họ lỗi).

## Nguyên nhân

Server (HB-126, khoá `strictObject` ở `apps/api/test/over/detection-helpers/contract.ts::alertItemSchema`) trả **một dòng mỗi booking** `{caseId, bookingId, propertyId, roomTypeId, date, status, overdue, label, deepLink}` và `meta` không có `scan`; hợp đồng HB-120 mô tả một dòng mỗi ca với `shortageCount`, `resolveDeadline`, `bookings[]` (tên khách đã che), `links[]` và `meta.scan`. Vì item là strict ở test khoá, server không thể bổ sung trường.

## Quyết định

- Hợp đồng `overbookingAlertSchema` theo đúng item server (strict). Server **bổ sung** `meta.scan` (meta của test khoá không strict) để lễ tân phân biệt "không có ca" với "chưa quét/quét lỗi".
- Android gom các dòng theo `caseId` về một thẻ (giữ thứ tự máy chủ), hiện `label` của máy chủ thay câu tự ghép, ẩn hạn khi không có; nút mở theo booking dùng số thứ tự (không có tên khách — tối thiểu PII).

## Tiêu chí nghiệm thu

1. Alert lễ tân parse được bằng `overbookingAlertsViewSchema` trên HTTP thật, `meta.scan` đổi sang `SUCCEEDED` sau lượt quét — test: `apps/api/test/over/read-contract.spec.ts::staff_alerts_parse_with_published_contract`.
2. Test khoá HB-126 (`detection-queries.locked.spec.ts::HB126_staff_alert_projection_without_case_privilege`) xanh, không sửa.
3. Android: hai booking cùng ca hiện một thẻ, hai nút mở — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` · integration `apps/api/test/over/**`.
