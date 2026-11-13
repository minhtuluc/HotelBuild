---
id: HB-306
title: Đồng bộ hệ giao diện Pine Hill–Amanoi cho Customer Android & Operations Android và xử lý TD-44
risk: R1
owner: gemini
max_lines: 900
allow:
  - apps/customer-android/**
  - apps/operations-android/**
unlock:
  - docs/08-thi-cong/tickets/HB-3*.md
---

# HB-306 — Đồng bộ giao diện Android Pine Hill–Amanoi & TD-44

> Tự soạn từ lộ trình frontend (`HB-300+`). Chuyển hóa hai ứng dụng Expo Android dùng chung bảng token `@pinehill/ui-native` và xử lý `TD-44`.

## Mục tiêu

Áp dụng hệ thống thiết kế Pine Hill–Amanoi (nền cát ấm `#F3EEE7`, thẻ ngà `#FDFAF6`, viền mảnh 1px, điểm nhấn xanh thông `#0F5E56`, nút chạm tối thiểu `48dp`, chữ tiền `tabular-nums`) đồng bộ lên toàn bộ màn hình của `apps/customer-android` (`SCR-71..83`) và `apps/operations-android` (`SCR-56..68`), đồng thời xử lý nợ kỹ thuật `TD-44` tách rạch ròi dữ liệu demo khỏi luồng chạy thật.

## Căn cứ

- Thiết kế màn hình: [thiet-ke-man-hinh.md](../../04-thiet-ke/thiet-ke-man-hinh.md) (`SCR-56..83`)
- Nợ kỹ thuật: [no-ky-thuat.md](../../07-ban-giao/no-ky-thuat.md) (`TD-44`)
- Nghiệp vụ: UC-FO-01, UC-FO-02, UC-FO-03, BR-RBAC-05, NFR-USE-03, NFR-LOC-01

## Tiêu chí nghiệm thu

1. Hai app `customer-android` và `operations-android` sử dụng màu sắc, khoảng cách, bán kính, `touchTargetDp = 48` từ `@pinehill/ui-native` đồng nhất với web.
2. `TD-44`: Rà soát và tách biệt dữ liệu demo trong `demo.ts` để màn hình thực tế không hiển thị dữ liệu giả ngoài chế độ demo/test, bảo toàn toàn bộ ca unit test hiện hành.
3. Không giữ lại chuỗi tiếng Việt cứng ngoài từ điển `messages.ts`/`strings.ts`.

## Ngoài phạm vi

- Không chạy giả lập/thiết bị Android thật nếu môi trường chưa cài đặt SDK (sẽ báo `BLOCKED` trong báo cáo nghiệm thu nếu thiếu thiết bị/SDK).

## Cổng phải xanh

`pnpm check:scope` · `corepack pnpm --filter @pinehill/customer-android typecheck` · `corepack pnpm --filter @pinehill/customer-android test` · `corepack pnpm --filter @pinehill/operations-android typecheck` · `corepack pnpm --filter @pinehill/operations-android test`
