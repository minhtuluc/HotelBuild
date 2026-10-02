---
id: HB-053
title: Engine chính sách huỷ thuần (packages/domain/cancellation) — US-CANCEL-01
risk: R2
owner: codex
max_lines: 800
allow:
  - packages/domain/src/cancellation/**
  - packages/domain/test/cancellation/**
---

# HB-053 — Engine chính sách huỷ

## Mục tiêu

Hàm thuần tính tiền hoàn/phạt khi huỷ toàn phần hoặc từng phòng, từ **snapshot** chính sách đã chốt lúc đặt; 11 bậc của 4 gói là dữ liệu, không phải `if/else`. Dùng ở huỷ (F5), trả phòng sớm (F7), walk-out (F6).

## Căn cứ

- [Chính sách huỷ & hoàn cọc](../../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) §2–§5 (thang mốc, bảng quyết định, ví dụ số)
- BR-CANCEL-01, BR-CANCEL-03…07, BR-CANCEL-19 (phân bổ huỷ một phần theo snapshot, dư theo `bookingRoomId`, không dùng lại phần đã xử lý); UC-BOOK-08; ADR-015
- TC-CANCEL-44 và các ca bảng quyết định trong cùng tài liệu; US-CANCEL-01, US-CANCEL-02 trong [kế hoạch sprint](../../05-ke-hoach/ke-hoach-sprint.md)

## Tiêu chí nghiệm thu

1. Xuất qua `@pinehill/domain/cancellation`. Đầu vào: snapshot policy (bậc, mốc giờ, % hoàn), `paidAmount` theo từng khoản đã thu, phần đã xử lý trước đó, tập `bookingRoomId` bị huỷ, `checkInDateTime`, `now`. Không I/O.
2. Chọn bậc theo số giờ trước giờ nhận phòng tại biên 336h/168h/72h/24h: đúng 168h00 và 167h59 rơi vào hai bậc khác nhau như tài liệu; policy thiếu bậc bắt tất (catch-all) → lỗi miền rõ ràng.
3. Tiền hoàn tính trên `paidAmount`, không trên tổng giá; `NONREF` không hoàn.
4. Huỷ một phần: phân bổ theo tỷ lệ snapshot từng dòng; hai lần huỷ liên tiếp không dùng lại cùng phần tiền (BR-CANCEL-19).
5. Test: 100% ca bảng quyết định của tài liệu là dữ liệu chạy (`test.each`), tên chứa mã TC; test thuộc tính TC-CANCEL-44: hoàn không bao giờ vượt tiền đã trả và không tăng khi huỷ muộn hơn.
6. Phủ nhánh ≥ 90%; `pnpm run ci` xanh.

## Ngoài phạm vi

- RefundRequest, maker-checker, chi hoàn (HB-097, HB-099, HB-100); cấu hình policy (HB-057).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`

## Ghi chú cho người làm

Chạy song song với HB-032, HB-052 — chỉ sửa thư mục `cancellation`. Giờ nhận phòng lấy từ đầu vào (`checkInDateTime` đã tính theo giờ VN ở tầng ứng dụng, Q-08), engine không tự đổi múi giờ.
