---
id: HB-000
title: <một dòng mô tả kết quả>
risk: R1 # R0 | R1 | R2 — xem ../README.md §2
owner: deepseek # deepseek | codex | gemini | opus
max_lines: 400
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
locked: # test khoá do người duyệt viết; R2 bắt buộc có
  - apps/operations-web/test/<ten>.locked.spec.ts
unlock: # file được bảo vệ mà ticket này được sửa — chỉ lead điền
---

# HB-000 — <tiêu đề>

> Mẫu. Sao chép thành `HB-nnn-<slug>.md`, thay mọi `<...>`. File này không phải ticket thật (`check:scope` chỉ đọc file bắt đầu bằng `HB-nnn`).

## Mục tiêu

<Người dùng/hệ thống làm được gì sau ticket này. Một đoạn.>

## Căn cứ

- Pha: F<n> — mục tương ứng trong [lộ trình thi công](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md)
- Quy tắc nghiệp vụ: BR-<MOD>-<nn>
- Use case / yêu cầu: UC-<MOD>-<nn>, FR-<MOD>-<nn>
- API: `<METHOD> /api/v1/<path>`; mã lỗi `E_<...>`
- Màn hình: `SCR-<nn>`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. <Cho … khi … thì …> — test: `<file>::<tên ca>`
2. <Ca âm / biên / quyền / lỗi mạng>

## Ngoài phạm vi

- <Những gì ticket này không làm, để người làm không mở rộng.>

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · <`npm run check` nếu đụng docs/scripts> · <`pnpm test:e2e` nếu có màn hình>

## Ghi chú cho người làm

<Bẫy đã biết, file tham khảo, quyết định đã chốt.>
