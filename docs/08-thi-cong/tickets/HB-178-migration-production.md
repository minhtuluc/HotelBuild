---
id: HB-178
title: Migration production — expand → migrate → contract, kiểm csdl §8.3 sau migrate
risk: R2
owner: codex
max_lines: 400
allow:
  - scripts/**
  - apps/api/prisma/**
  - docs/07-ban-giao/van-hanh/**
---

# HB-178 — Migration production — expand → migrate → contract, kiểm csdl §8.3 sau migrate

## Mục tiêu

Mọi migration lên production an toàn, chỉ tiến, có kiểm sau migrate và nhật ký triển khai.

## Căn cứ

- csdl §8.2, §8.3; QĐ-02 mục 2–4
- Phụ thuộc: HB-005, HB-175

## Tiêu chí nghiệm thu

1. Script chạy migration trên staging rồi production với `DATABASE_MIGRATION_URL` riêng; snapshot trước migrate.
2. Sau migrate chạy 3 truy vấn kiểm §8.3; lỗi → dừng deploy.
3. Runbook `docs/07-ban-giao/van-hanh/migration.md`: expand → migrate → contract, `CREATE INDEX CONCURRENTLY`, `lock_timeout`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
