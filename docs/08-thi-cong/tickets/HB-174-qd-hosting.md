---
id: HB-174
title: Quyết định hosting production (QĐ-nn) — nhà cung cấp, vùng, chi phí, backup off-site
risk: R0
owner: opus
max_lines: 200
allow:
  - docs/05-ke-hoach/nhat-ky/**
  - docs/08-thi-cong/lo-trinh-den-deploy.md
---

# HB-174 — Quyết định hosting production (QĐ-nn) — nhà cung cấp, vùng, chi phí, backup off-site

## Mục tiêu

Chốt nơi chạy api/worker/PostgreSQL/Redis trước khi dựng hạ tầng.

## Căn cứ

- kiến trúc §7 (Vercel cho web, EAS cho Android, máy chủ ứng dụng Docker Engine); [lộ trình đến deploy](../lo-trinh-den-deploy.md) §5 mục 1
- Phụ thuộc: —

## Tiêu chí nghiệm thu

1. Lead lập 2–3 phương án (VPS Docker Engine, PaaS container, managed PostgreSQL) với chi phí ước tháng, RPO/RTO đạt được, độ phức tạp vận hành.
2. Người dùng chọn; ghi QĐ-nn. Chưa chọn tới hạn thì áp mặc định ở lộ trình §5 mục 1 và ghi "giả định dùng tạm".
3. Ghi rõ vị trí lưu backup off-site và ai giữ khoá truy cập.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
