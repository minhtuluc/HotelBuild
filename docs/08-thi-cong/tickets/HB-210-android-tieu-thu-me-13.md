---
id: HB-210
title: Operations Android — tên khách SCR-57, số xem trước SCR-61/64, lối walk-in từ SCR-57
risk: R1
owner: deepseek
max_lines: 650
allow:
  - apps/operations-android/app/**
  - apps/operations-android/src/**
  - apps/operations-android/test/**
  - tests/maestro/**
---

# HB-210 — Operations Android tiêu thụ hợp đồng mẻ 13

## Mục tiêu

Đóng các khoảng trống đã ghi ở PR HB-153/154/155/157: thẻ khách đến có tên khách; SCR-61 hiện phụ thu trả muộn và SCR-64 hiện số tiền no-show **trước** khi xác nhận bằng số máy chủ trả; SCR-57 có nút "+ Khách vãng lai" mở SCR-65.

## Căn cứ

- SCR-57, SCR-61, SCR-64, SCR-65; UC-FO-01, UC-FO-02, UC-FO-04; thiết kế màn hình §4.8, §5.1, §5.2, §5.4, §8.1
- Phụ thuộc: HB-208 (`GET /guests/{guestId}`), HB-209 (preview) đã merge; HB-153/154/155/157 trên `main`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. SCR-57: thẻ hiện tên khách từ `GET /guests/{guestId}` (tải theo lô, giới hạn đồng thời); lỗi/403/404 ⇒ thẻ vẫn hiện không tên, không chặn check-in; không lưu tên ra đĩa.
2. SCR-61: trước nút xác nhận hiện `feeAmount`/`extrasAmount`/`balanceDue` của preview kèm mốc tính (giờ VN) và câu "số chốt do máy chủ khi xác nhận"; đổi lựa chọn trả muộn/sớm ⇒ tải lại preview; lỗi preview không chặn xác nhận nhưng nói rõ chưa có số.
3. SCR-64: hiện `penaltyAmount`/`expectedRefundAmount` và đếm ngược tới `markableFrom` (đồng hồ bơm qua port).
4. SCR-57: nút "+ Khách vãng lai" mở luồng SCR-65 hiện có; quay về làm mới danh sách.
5. Offline: không gọi preview, nói rõ cần mạng; không báo thành công thao tác tiền.
6. Vitest logic + harness UI; Maestro cập nhật `tests/maestro/hb15*-*.yaml` hoặc thêm `hb210-*.yaml`; nhãn trợ năng đủ.

## Ngoài phạm vi

- Camera QR (`expo-camera` cần duyệt dependency), cache bền qua khởi động lại (OPEN-02).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · bundle Hermes; Maestro/thiết bị `BLOCKED` nếu không có máy

## Ghi chú cho người làm

Không tự tính tiền hay mốc 23:59 ở client: đếm ngược chỉ hiển thị theo `markableFrom` máy chủ trả. Tái dùng `formatVnd`, `formatVnDateTime` và mẫu writer/reader của `src/arrivals`, `src/stay`, `src/no-show`.
