---
id: HB-307
title: Kiểm định tổng thể CI, Impeccable Detect, Playwright E2E, ảnh trước/sau và tổng hợp YEU-CAU-API-TU-FRONTEND
risk: R0
owner: gemini
max_lines: 600
allow:
  - YEU-CAU-API-TU-FRONTEND.md
  - docs/07-ban-giao/**
  - tests/e2e/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-307 — Kiểm định tổng thể, Bằng chứng Thị giác & Yêu cầu API từ Frontend

> Tự soạn từ lộ trình frontend (`HB-300+`). Kiểm chứng toàn bộ monorepo sau khi hoàn thành `HB-300`..`HB-306`.

## Mục tiêu

Chạy đầy đủ các cổng kiểm chứng (`lint`, `typecheck`, `format:check`, unit test toàn monorepo, kiểm tra tài liệu `check:docs`), quét `impeccable detect`, chạy bộ E2E Playwright (Chromium) và `axe-core` cho toàn bộ 83 màn hình trong danh mục, chụp ảnh nghiệm thu ở hai kích thước (`1440×900` và `360×800`), và chốt tài liệu `YEU-CAU-API-TU-FRONTEND.md` gửi backend.

## Căn cứ

- Luật kiểm chứng & bàn giao: [no-ky-thuat.md](../../07-ban-giao/no-ky-thuat.md), [bang-chung-a11y.md](../../07-ban-giao/bang-chung-a11y.md), [bang-chung-i18n.md](../../07-ban-giao/bang-chung-i18n.md)
- Nghiệp vụ & truy vết: NFR-USE-01, NFR-USE-02, NFR-LOC-01

## Tiêu chí nghiệm thu

1. Toàn bộ unit test (`ui-web`, `ui-native`, `web-session`, `operations-web`, `customer-web`, `operations-android`, `customer-android`), `lint`, `typecheck` và `check:docs` đạt 100%.
2. Chạy `impeccable detect` trên mã nguồn frontend và live server (`localhost:3001`, `localhost:3002`) ghi nhận kết quả rõ ràng.
3. Chạy Playwright E2E trên Chromium xanh; WebKit và thiết bị Android thật báo đúng trạng thái `BLOCKED` nếu môi trường không hỗ trợ.
4. Lưu ảnh chụp màn hình trước/sau ở hai kích thước `1440×900` và `360×800` trong thư mục artifact để người dùng nghiệm thu.

## Ngoài phạm vi

- Không tự merge PR; không sửa mã backend hay `packages/contracts`.

## Cổng phải xanh

`npm run check:docs` · `corepack pnpm run lint` · `corepack pnpm run typecheck` · `corepack pnpm test` · Playwright E2E Chromium · `impeccable detect`
