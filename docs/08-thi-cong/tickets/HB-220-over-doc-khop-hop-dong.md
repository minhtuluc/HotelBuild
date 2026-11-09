---
id: HB-220
title: Đường đọc ca quá tải khớp hợp đồng công bố — SCR-43/44 và SCR-67 decode được trên API thật
risk: R1
owner: claude
max_lines: 600
allow:
  - apps/api/src/modules/over/queries/**
  - apps/api/src/modules/over/detection/candidates.ts
  - apps/api/src/modules/over/support.ts
  - apps/api/src/modules/over/planning/service.ts
  - apps/api/test/over/read-contract.spec.ts
  - packages/contracts/src/overbooking.ts
  - packages/contracts/src/enums.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/f6/**
  - packages/api-client/test/f6/**
  - apps/operations-web/src/features/hb135-scr43-bang-qua-tai/**
  - apps/operations-web/src/features/hb136-scr44-dieu-chuyen/**
  - apps/operations-web/test/hb135-scr43-bang-qua-tai/**
  - apps/operations-web/test/hb136-scr44-dieu-chuyen/**
  - apps/operations-android/src/features/f6-overbooking/**
  - apps/operations-android/test/f6-overbooking/**
  - docs/04-thiet-ke/api.md
---

# HB-220 — Đường đọc ca quá tải khớp hợp đồng công bố

## Mục tiêu

`GET /overbooking-cases` và `GET /overbooking-cases/{caseId}` trả đúng hình dạng mà `@pinehill/contracts` công bố, để BFF ops-web (`app/api/session/sys/f6-route.ts`) và operations Android decode được trên API thật. Lượt QA HB-194 (QA-F6-07, QA-F6-08) đo được SCR-43 nhận `502` từ BFF vì decode hỏng.

## Nguyên nhân (đo trên `059cdd8`)

1. `meta.scan`: server (`queries/scan-meta.ts`, khoá bằng test HB-126 `detection-queries.locked.spec.ts::HB126_scan_freshness_and_unknown_empty`, `toEqual` chính xác) trả `{status, lastSuccessAt, dataAsOf}`; hợp đồng HB-120 ghi `{scanStatus, lastSuccessfulScanAt, nextScanAt, scannedThrough}`.
2. Tóm tắt ca thiếu `escalatedAt`, `version` (hợp đồng bắt buộc).
3. `ladderPreview` thiếu `step` và lý do cho bậc 1/2 không khả dụng (hợp đồng `relocationLadderSchema` bắt buộc) — phát hiện khi viết test hợp đồng của ticket này.
4. Chi tiết ca thiếu `history`; `candidates` của bộ chọn HB-126 có `keepScore` là **số** + `keepScoreBreakdown` (khoá ở `detection-helpers/contract.ts`), trong khi hợp đồng dùng `relocationCandidateSchema` của planner (`keepScore` là bảng phân rã) và thiếu rank, tên đã che, kỳ ở, tiền.

## Quyết định

- Test khoá HB-126 là nguồn hành vi; hợp đồng được chỉnh theo server ở hai điểm không thể bổ sung (scan meta, `keepScore` số). Đây là thay đổi phá vỡ **so với bản HB-120**, nhưng `pnpm check:contract` báo 0 phá vỡ so với bản nền 1.0.0 (F6 có sau bản nền) và client duy nhất là BFF/Android trong repo, vốn đang hỏng.
- Server **bổ sung** (không bỏ trường nào): `escalatedAt`, `version`, `history` (từ `detected_at`/`escalated_at`/`resolved_at`), và trường hiển thị cho ứng viên chi tiết ca. Thứ tự/điểm giữ nguyên.
- Hợp đồng tách `overbookingCaseCandidateSchema` (chi tiết ca) khỏi `relocationCandidateSchema` (plan). SCR-44 chuẩn hoá hai nguồn về một dòng hiển thị, không tính lại điểm.

## Tiêu chí nghiệm thu

1. Danh sách và chi tiết ca parse được bằng `overbookingCaseListSchema`/`overbookingCaseDetailSchema` trên HTTP thật, kể cả `meta.scan` `NEVER` → `SUCCEEDED` sau lượt quét — test: `apps/api/test/over/read-contract.spec.ts`.
2. Test khoá HB-126 (`detection-queries.locked.spec.ts`, `detection.locked.spec.ts`) vẫn xanh, không sửa.
3. SCR-43 (ops-web) và SCR-67 (Android) đọc `status/lastSuccessAt`; "rỗng thật" chỉ khi `SUCCEEDED` có mốc — test: `apps/operations-web/test/hb135-scr43-bang-qua-tai/screen.spec.ts::empty_requires_successful_scan`, `apps/operations-android/test/f6-overbooking/screen.spec.ts`.
4. SCR-44 hiển thị đúng số máy chủ cho cả hai nguồn ứng viên — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/candidate-row.spec.ts`.

## Ngoài phạm vi

`GET /overbooking-alerts` (dạng item khác hợp đồng, Android SCR-67) — HB-221. Không đổi luật xếp hạng, quét hay quyền.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` · integration `apps/api/test/over/**`.
