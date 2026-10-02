---
id: HB-176
title: Bí mật & biến môi trường (GitHub secrets, Vercel env, EAS secrets) + quét gitleaks
risk: R2
owner: codex
max_lines: 300
allow:
  - .github/workflows/**
  - infra/**
  - docs/07-ban-giao/van-hanh/**
unlock:
  - .github/workflows/**
---

# HB-176 — Bí mật & biến môi trường (GitHub secrets, Vercel env, EAS secrets) + quét gitleaks

## Mục tiêu

Mọi biến bắt buộc ở kiến trúc §7.1 có nguồn bí mật cho từng môi trường; repo 0 bí mật.

## Căn cứ

- kiến trúc §7.1; NFR-SEC-06
- Phụ thuộc: HB-175

## Tiêu chí nghiệm thu

1. Bảng biến × môi trường × nơi lưu trong `docs/07-ban-giao/van-hanh/bien-moi-truong.md` (không chứa giá trị).
2. Job `gitleaks` chạy trên mọi PR; lịch xoay vòng khoá JWT/PSP ghi rõ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
