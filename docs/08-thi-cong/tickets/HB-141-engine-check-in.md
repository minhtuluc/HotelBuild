---
id: HB-141
title: Engine CheckInPolicy thuần (packages/domain/front-office)
risk: R2
owner: codex
max_lines: 450
allow:
  - packages/domain/src/front-office/**
  - packages/domain/test/front-office/**
  - packages/domain/package.json
---

# HB-141 — Engine CheckInPolicy thuần (packages/domain/front-office)

## Mục tiêu

Hàm thuần quyết định có cho check-in không: CONFIRMED, `balanceDue = 0` hoặc được MANAGER+ cho nợ trong ngưỡng, đúng ngày VN, trước 23:59, đơn vị cần giao sẵn sàng; tính phụ thu nhận sớm.

## Căn cứ

- BR-FO-01, BR-FO-02, BR-FO-04, BR-FO-07; TC-FO-01, TC-FO-02, TC-FO-04
- Phụ thuộc: HB-003

## Tiêu chí nghiệm thu

1. Thêm subpath `@pinehill/domain/front-office` vào `packages/domain/package.json` theo mẫu `inventory`/`pricing` (export điều kiện `pinehill-dist`).
2. Cho nợ chỉ khi **đồng thời** nợ ≤ 5.000.000 VND **và** ≤ 50% `totalAmount`, người duyệt MANAGER+ (BR-FO-01); 4 lượt TC-FO-01.
3. Từ 23:59:00 ngày nhận phòng (gồm đúng mốc) → từ chối, yêu cầu xử lý no-show (TC-FO-02).
4. Nhận sớm: 08:00–12:00 miễn phí nếu sẵn sàng; 12:00–14:00 thu 30% giá đêm đầu; trước 08:00 phải đặt thêm 1 đêm (BR-FO-04, TC-FO-04). Tiền số nguyên, làm tròn theo BR-GEN-03.
5. Thời gian và múi giờ là tham số (giờ VN tính ở tầng ứng dụng); 0 I/O; phủ nhánh ≥ 90%.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
