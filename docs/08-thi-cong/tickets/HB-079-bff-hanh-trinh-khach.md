---
id: HB-079
title: BFF customer-web cho journey khách + API giả E2E (availability, quote, booking, hold)
risk: R2
owner: codex
max_lines: 500
allow:
  - packages/web-session/**
  - apps/customer-web/src/app/api/session/**
  - tests/e2e/fake-api/journey/**
  - apps/customer-web/test/session/**
---

# HB-079 — BFF customer-web cho journey khách + API giả E2E (availability, quote, booking, hold)

## Mục tiêu

Customer web gọi được journey khách: phần công khai không cần đăng nhập, phần đặt phòng dùng phiên khách của HB-019; API giả có đủ kịch bản để HB-080…HB-083 làm E2E.

## Căn cứ

- QĐ-03 quyết định 1; ADR-018; HB-019 (BFF, API giả dùng chung)
- Phụ thuộc: HB-019, HB-070

## Tiêu chí nghiệm thu

1. Khách chưa đăng nhập tìm phòng, xem giá, chọn gói được; giữ chỗ/đặt yêu cầu phiên (hoặc luồng tạo tài khoản ngay trong bước 5 — chọn và ghi lý do).
2. API giả `tests/e2e/fake-api/journey/`: availability, quotes (kèm hết hạn), holds (kèm `E_INV_ROOM_TAKEN`), bookings (kèm `duplicateSuspected`).
3. E2E cũ vẫn xanh.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
