---
id: HB-191
title: UAT 3 kịch bản × 4 frontend × từng actor; biên bản ký
risk: R0
owner: gemini
max_lines: 300
allow:
  - docs/07-ban-giao/uat/**
---

# HB-191 — UAT 3 kịch bản × 4 frontend × từng actor; biên bản ký

## Mục tiêu

Người dùng thật (hoặc người dùng đại diện) chạy các kịch bản nghiệp vụ và ký biên bản.

## Căn cứ

- [bàn giao](../../07-ban-giao/huong-dan-thi-cong.md) §5 (cổng Sản phẩm); lộ trình M8
- Phụ thuộc: HB-185, HB-187, HB-188

## Tiêu chí nghiệm thu

1. Kịch bản: đặt–thanh toán–huỷ/hoàn; quá tải–điều chuyển; tiền sảnh–check-in/out; mỗi actor chính một lượt.
2. 0 lỗi P0/P1 mở khi ký; lỗi P2/P3 vào nợ kỹ thuật kèm hạn.
3. Biên bản `docs/07-ban-giao/uat/bien-ban-<ngày>.md` có người chạy, người ký, phiên bản.

## Cổng phải xanh

`npm run check:docs`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
