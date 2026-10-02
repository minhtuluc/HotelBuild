---
id: HB-100
title: Worker chi hoàn — operation bền, đối soát trước retry, timeout không trả reservation
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/api/src/modules/pay/payouts/**
  - apps/api/test/chi-hoan/**
  - apps/api/prisma/migrations/**
  - apps/worker/src/**
  - apps/worker/test/**
---

# HB-100 — Worker chi hoàn — operation bền, đối soát trước retry, timeout không trả reservation

## Mục tiêu

Chi tiền hoàn về phương thức gốc **đúng một lần** kể cả khi crash sau khi PSP đã chi; timeout không làm mất hạn mức đã giữ.

## Căn cứ

- ADR-016 (bảng payout + lease); api.md §2.6 (`/refund-requests/{refundRequestId}/pay`); UC-PAY-04; BR-CANCEL-12, BR-PAY-08, BR-PAY-09
- Phụ thuộc: HB-099, HB-095, HB-006, HB-013 (xác thực), HB-014 (`@Permission`, phạm vi cơ sở), HB-009 (`AuditWriter`)

## Tiêu chí nghiệm thu

1. Thêm migration tiến cho bảng thao tác chi (nếu §3 chưa có) theo QĐ-02 mục 3.
2. Trước mỗi lần thử lại: truy vấn/đối soát với PSP theo khoá bền; đã chi → đánh dấu PAID, không gửi lần hai.
3. Timeout → trạng thái chờ đối soát, giữ reservation; tiền mặt → chuyển khoản theo tài liệu.
4. Test: crash giả lập sau khi PSP giả lập trả thành công, trước commit → chạy lại không tạo khoản chi thứ hai.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Codex có thể viết test khoá rồi giao phần còn lại cho DeepSeek (QĐ-04).
