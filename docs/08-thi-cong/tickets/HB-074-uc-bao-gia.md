---
id: HB-074
title: UC + endpoint POST /quotes — quote bất biến 15 phút gắn principal + fingerprint
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/rate/quotes/**
  - apps/api/test/quotes/**
---

# HB-074 — UC + endpoint POST /quotes — quote bất biến 15 phút gắn principal + fingerprint

## Mục tiêu

Báo giá cho khách một con số **không đổi** trong 15 phút, chỉ dùng được bởi đúng người, đúng kênh, đúng kỳ; hết hạn thì yêu cầu báo giá mới chứ không tự tăng giá.

## Căn cứ

- ADR-015 (1, 2); api.md §3.1; BR-RATE-15, BR-RATE-17; UC-RATE-05
- Loader dữ kiện giá `modules/rate/pricing-facts` (HB-056) + engine HB-052
- Phụ thuộc: HB-070, HB-056, HB-029, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Lưu quote (Redis TTL 900 giây **và** đủ thông tin để xác minh không phụ thuộc Redis khi chốt — ghi rõ lựa chọn); `fingerprint` băm đầu vào chuẩn hoá + principal + `engineVersion`.
2. Dùng quote khác principal/kênh/kỳ → `E_RATE_QUOTE_MISMATCH`; hết hạn → 410 `E_RATE_QUOTE_EXPIRED`.
3. Đổi cấu hình giá không làm đổi quote còn hạn (test).
4. Kết quả khớp `quotes/multi-channel` từng VND cho cùng đầu vào.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).
