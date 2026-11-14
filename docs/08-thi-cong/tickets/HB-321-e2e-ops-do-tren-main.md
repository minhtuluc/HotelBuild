---
id: HB-321
title: Chín ca E2E operations-web đỏ trên main xanh lại — fixture theo hợp đồng HB-220, câu sau #298, CORS theo cổng thật, vùng cuộn SCR-55
risk: R1
owner: claude
max_lines: 150
allow:
  - tests/e2e/f6/hb135-scr43-bang-qua-tai.spec.ts
  - tests/e2e/f6/hb136-scr44-dieu-chuyen.spec.ts
  - tests/e2e/scr35-36-sua-huy-ops.spec.ts
  - tests/e2e/scr38-duyet-hoan-ops.spec.ts
  - apps/operations-web/src/app/(ops)/reports/report-tables.tsx
---

# HB-321 — Chín ca E2E operations-web đỏ trên `main`

## Mục tiêu

Bộ E2E project `operations-web` chạy trên bản build production của `main` (6fcb6b4) có 9 ca đỏ; CI hiện không chạy bộ này nên `main` vẫn xanh. Ticket đưa 9 ca về xanh bằng cách sửa đúng chỗ gốc: mã màn khi màn sai, test khi test lỗi thời so với đặc tả/hợp đồng hiện hành — không nới ý kiểm.

## Căn cứ

- Hợp đồng ca quá tải sau HB-220 (`packages/contracts/src/overbooking.ts`: `overbookingScanMetadataSchema`, `overbookingCaseCandidateSchema`) — đặc tả `HB-220-over-doc-khop-hop-dong.md`.
- Màn: SCR-43 (HB-135), SCR-44 (HB-136), SCR-35 (HB-108), SCR-38 (HB-110), SCR-55 (HB-165; quét axe HB-185 và F8).
- Không ca nào thuộc diện `locked`; không chạm file `PROTECTED`.

## Nguyên nhân (đo trên 6fcb6b4)

1. SCR-43 (2 ca): HB-220 (#269) đổi `meta.scan` thành `{status, lastSuccessAt, dataAsOf}` và cập nhật fixture unit, nhưng fixture E2E còn `{scanStatus, lastSuccessfulScanAt, nextScanAt, scannedThrough}` → client decode hỏng, không hiện dòng `k1`.
2. SCR-44 (1 ca): cũng HB-220 — ứng viên chi tiết ca dùng `keepScore` số + `keepScoreBreakdown`; fixture E2E còn `keepScore` dạng bảng phân rã của planner → decode hỏng, không hiện ứng viên.
3. SCR-55 (2 ca axe): khung bảng báo cáo dùng chung là vùng `overflowX: auto` không nhận focus, không tên. HB-185 lượt 2 (#264) còn PASS; sau #298 đổi khung sang `ph-card` + `OPS_TABLE_WRAP_STYLE` (viền, số tabular) bảng quá tải tràn khung nên axe bắt `scrollable-region-focusable`. Màn khác trong repo đã dùng mẫu `role="region"` + `aria-label` + `tabIndex={0}` cho cùng kiểu khung.
4. SCR-35 (1 ca): #298 viết lại câu `ops.reschedule.feePending`; assertion còn chuỗi cũ "chưa có trường này". Báo giá đổi ngày vẫn chưa có trường phí, câu mới giữ cùng ý.
5. SCR-38 (3 ca): phản hồi giả gắn `access-control-allow-origin` theo `E2E_OPERATIONS_WEB_PORT ?? '3002'` thay vì origin thật của app → chạy app ở cổng khác (không đặt biến) thì CORS chặn, màn thấy lỗi mạng ("chưa xác định") thay cho 401/403.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. SCR-43 hiện ca `k1`, giữ khoá khi kết quả chưa rõ — test: `tests/e2e/f6/hb135-scr43-bang-qua-tai.spec.ts::browser_keyboard_a11y_responsive`, `::quá hạn giữ ca và báo leo thang; kết quả chưa rõ giữ nguyên khoá`.
2. SCR-44 hiện ứng viên — test: `tests/e2e/f6/hb136-scr44-dieu-chuyen.spec.ts::browser_keyboard_a11y_responsive`.
3. SCR-55 không còn vi phạm serious/critical; vùng cuộn bảng báo cáo có `role="region"`, nhãn và `tabIndex={0}` — test: `tests/e2e/a11y/scan.spec.ts::SCR-55 — Báo cáo quá tải & điều chuyển`, `tests/e2e/f8/axe-f8.spec.ts::SCR-55 quá tải không có vi phạm serious/critical`.
4. SCR-35 hiện ghi chú phí đổi ngày đúng nguyên câu hiện hành — test: `tests/e2e/scr35-36-sua-huy-ops.spec.ts::đổi ngày: chênh lệch trước xác nhận + ghi chú phí chờ hợp đồng (AC2)`.
5. SCR-38 PIN preflight/denied và đọc bị từ chối muộn đạt ở mọi cổng app — test: `tests/e2e/scr38-duyet-hoan-ops.spec.ts` (3 ca nêu trên).

## Ngoài phạm vi

- Đưa bộ E2E này vào CI; không đổi hợp đồng, BFF hay fake API.
- PR #309 (HB-314) và #315 (HB-320) — ticket làm từ `main`, không chồng lên.

## Cổng phải xanh

`pnpm check:scope` · tsc/eslint/unit operations-web · E2E project `operations-web` trên bản build (`--repeat-each 2` cho các tệp trên).
