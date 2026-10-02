---
id: HB-175
title: Hạ tầng staging/production bằng IaC
risk: R2
owner: codex
max_lines: 800
allow:
  - infra/**
  - docker/**
  - .github/workflows/**
unlock:
  - .github/workflows/**
---

# HB-175 — Hạ tầng staging/production bằng IaC

## Mục tiêu

Dựng lại staging (và production cùng mẫu) từ đầu bằng một lệnh: api + worker (một image, 2 entrypoint), PostgreSQL 16 có WAL/PITR, Redis 7 có AOF, reverse proxy + TLS.

## Căn cứ

- kiến trúc §7, §7.1; NFR-SEC-03 (TLS/HSTS); NFR-REL-04
- Phụ thuộc: HB-174, HB-027, HB-006

## Tiêu chí nghiệm thu

1. IaC trung lập nhà cung cấp tới mức hợp lý (Compose/Ansible/Terraform tuỳ QĐ hosting) nằm trong `infra/`; không có bí mật trong repo.
2. Một lệnh dựng staging sạch; api/worker đọc cấu hình đã validate, thiếu biến → không khởi động.
3. TLS hợp lệ, HSTS, chỉ mở cổng cần thiết; PostgreSQL/Redis không ra Internet.
4. Tài liệu vận hành ngắn trong `infra/README.md`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
