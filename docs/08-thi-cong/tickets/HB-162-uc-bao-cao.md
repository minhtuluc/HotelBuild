---
id: HB-162
title: UC + endpoint báo cáo đọc + RBAC phạm vi cơ sở
risk: R1
owner: deepseek
max_lines: 700
allow:
  - apps/api/src/modules/rep/**
  - apps/api/test/reports/**
---

# HB-162 — UC + endpoint báo cáo đọc + RBAC phạm vi cơ sở

## Mục tiêu

Sáu báo cáo đọc trả số liệu từ engine HB-161 trên dữ liệu thật, đúng phạm vi cơ sở và vai trò.

## Căn cứ

- api.md §2.12; UC-REP-01…04; BR-REP-01, BR-CANCEL-13, BR-OVER-15, BR-OVER-16; TC-REP-02, TC-REP-03
- Phụ thuộc: HB-160, HB-161, HB-013, HB-014, HB-009

## Tiêu chí nghiệm thu

1. Truy vấn tổng hợp ở CSDL (không kéo toàn bộ dòng về ứng dụng); kỳ tối đa theo hợp đồng.
2. MANAGER chỉ cơ sở trong phạm vi (`E_AUTH_OUT_OF_SCOPE`); báo cáo tài chính chỉ ACCOUNTANT/OWNER (TC-REP-02, TC-REP-03).
3. Doanh thu theo kênh đọc từ snapshot giá/hoa hồng lúc bán, **không** từ cấu hình hiện tại (hướng dẫn thi công §2, dòng "báo cáo dùng hoa hồng hiện tại").
4. Test trên dữ liệu giả có booking huỷ, ghép phòng, walk-out: số khớp tính tay.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
