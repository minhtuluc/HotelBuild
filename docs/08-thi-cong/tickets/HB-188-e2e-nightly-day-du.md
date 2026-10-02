---
id: HB-188
title: Nightly đầy đủ: Playwright 2 web + Maestro 2 Android + k6 rút gọn
risk: R2
owner: codex
max_lines: 300
allow:
  - .github/workflows/**
  - tests/**
unlock:
  - .github/workflows/**
---

# HB-188 — Nightly đầy đủ: Playwright 2 web + Maestro 2 Android + k6 rút gọn

## Mục tiêu

Mỗi đêm chạy toàn bộ E2E và tải rút gọn trên staging, báo đỏ trước khi người dùng phát hiện.

## Căn cứ

- kiến trúc §7 (`e2e-nightly.yml`); NFR-MAIN-03
- Phụ thuộc: HB-184, HB-189

## Tiêu chí nghiệm thu

1. Playwright Chromium + WebKit < 20 phút; Maestro 2 app < 10 phút (runner có emulator hoặc dịch vụ thiết bị — ghi lựa chọn và chi phí); 0 test bị bỏ qua không giải thích.
2. Đỏ → báo kênh kỹ thuật kèm link log.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
