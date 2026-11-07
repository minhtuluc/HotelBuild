---
id: HB-218
title: Sửa 14 node chuỗi tiếng Việt ngoài danh mục còn lại sau rà i18n lượt 2 (HB-186)
risk: R0
owner: claude
max_lines: 400
allow:
  - apps/operations-web/src/features/hb132-scr40-cau-hinh-kenh/**
  - apps/operations-web/src/session/**
  - apps/operations-web/src/app/(ops)/front-desk/**
  - apps/operations-web/test/auth/**
  - apps/operations-web/test/hb218-i18n-source.spec.ts
  - apps/operations-android/src/lookup/**
  - apps/operations-android/src/arrivals/**
  - apps/operations-android/src/stay/**
  - apps/operations-android/test/lookup-view.spec.ts
  - apps/operations-android/test/lookup-i18n-source.spec.ts
  - packages/ui-web/src/format.ts
  - packages/ui-web/src/messages.ts
  - packages/ui-web/test/format-i18n-source.spec.ts
---

# HB-218 — Sửa 14 node chuỗi tiếng Việt ngoài danh mục

> Tự soạn theo QĐ-04 từ phát hiện của [bang-chung-i18n.md](../../07-ban-giao/bang-chung-i18n.md) §2 A–B (lượt 2, 08/11/2026); lead duyệt ở bước cuối.

## Mục tiêu

Đưa 14 node UI còn lại ra khỏi mã nguồn vào danh mục i18n (NFR-LOC-01), **không đổi hành vi**: cùng câu chữ, cùng định dạng.

## Căn cứ

- NFR-LOC-01…03; HB-186 (rà i18n), phát hiện §2 A (6 node trong app) và §2 B (8 node `formatStayPeriod`/`formatRemaining`).

## Tiêu chí nghiệm thu

1. `operations-web`: `cancelLabel` của hai `ConfirmDialog` HB-132, đơn vị chờ của `formatWait` ("giây"/"phút") và thông điệp "Cơ sở ngoài phạm vi" của SCR-48 lấy từ danh mục; `formatWait` tách thành `waitParts` (số + đơn vị) và câu chữ ở `view-text.ts` — test: `test/auth/login-model.spec.ts`, `test/auth/view-text.spec.ts`, `test/hb218-i18n-source.spec.ts`.
2. `operations-android`: nhãn "đêm" của kỳ ở lấy từ danh mục `lookup/messages.ts` (`stayPeriodText`); `formatStay` thuần nhận nhãn từ nơi gọi để test Node không kéo `react-native` — test: `test/lookup-view.spec.ts`, `test/lookup-i18n-source.spec.ts`.
3. `packages/ui-web`: `formatStayPeriod` và `formatRemaining` dựng câu từ `viCatalog` (`format.stayPeriod`, `format.remaining.*`), đầu ra không đổi — test: `test/format.spec.ts` (giữ nguyên), `test/format-i18n-source.spec.ts`.
4. Quét AST của HB-186: 31 → 25 ứng viên trong app (hết 6 node UI), `ui-web/src/format.ts` chỉ còn hai lỗi lập trình và nhãn `(giờ VN)`.

## Ngoài phạm vi

- 4 node "nguy cơ gián tiếp" (§2 C: thông điệp `ApiError`/thân lỗi BFF) — chưa kết luận, cần quyết định riêng.
- Tiền, tồn, quyền, hợp đồng; QA hình ảnh/thiết bị Android (BLOCKED).
- Cập nhật `bang-chung-i18n.md` (chờ PR HB-186 lượt 2 vào main, rồi quét lượt 3).

## Cổng phải xanh

`pnpm check:scope` · `pnpm lint` · `pnpm typecheck` · `pnpm format:check` · test của `ui-web`, `operations-web`, `operations-android`, `customer-web` (người dùng `formatStayPeriod`)
