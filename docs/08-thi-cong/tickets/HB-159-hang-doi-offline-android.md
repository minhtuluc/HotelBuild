---
id: HB-159
title: Hàng đợi offline operations Android — chỉ thao tác không xác nhận tiền/tồn
risk: R2
owner: codex
max_lines: 600
allow:
  - apps/operations-android/src/offline/**
  - apps/operations-android/test/offline/**
---

# HB-159 — Hàng đợi offline operations Android — chỉ thao tác không xác nhận tiền/tồn

## Mục tiêu

Nhân viên hiện trường ghi được thao tác khi mất mạng mà **không bao giờ** báo thành công cho thao tác tiền/tồn chưa được máy chủ xác nhận.

## Căn cứ

- OPEN-02 mặc định ([lộ trình đến deploy](../lo-trinh-den-deploy.md#5-quyết-định-còn-mở) mục 5); BR-GEN-08, BR-RBAC-05; api.md §1.6; TC-FO-08; thiết kế màn hình §8.3
- Phụ thuộc: HB-153, HB-154, HB-029

## Tiêu chí nghiệm thu

1. Trạng thái cục bộ: bản nháp → chờ đồng bộ → đang gửi → đã xác nhận | cần xử lý; chỉ xếp hàng loại thao tác trong danh sách cho phép (ghi chú, cập nhật buồng phòng, nháp tra cứu); thu/hoàn/check-in/check-out/giao phòng **bắt buộc** có mạng.
2. Giữ `Idempotency-Key`, payload và version khi gửi lại; quá TTL 24 giờ thì tra kết quả trước khi gửi; xung đột version → "cần xử lý", không tự ghi đè.
3. Không lưu PIN/pinToken xuống đĩa; dữ liệu hàng đợi lưu có mã hoá (secure storage cho khoá).
4. TC-FO-08 ở mức test logic.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · bundle Hermes; Maestro/smoke thiết bị ghi `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, hợp đồng phá vỡ, hai BR mâu thuẫn).

Nếu chủ đầu tư chốt OPEN-02 khác mặc định trước khi làm, cập nhật danh sách thao tác cho phép theo quyết định đó.
