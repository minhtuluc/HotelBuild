---
id: HB-211
title: Phân bổ khoản thu theo trọng số phòng — huỷ một phần không còn 422
risk: R2
owner: codex # bước tiền: cần Opus review độc lập trước merge
max_lines: 500
allow:
  - apps/api/src/modules/pay/**
  - apps/api/src/modules/book/cancel/**
  - apps/api/test/huy-mot-phan/**
  - apps/api/test/huy-booking/**
---

# HB-211 — Phân bổ khoản thu theo trọng số phòng

## Mục tiêu

Booking nhiều phòng đã thu cọc: huỷ **một phần** (một phòng) luôn thành công và hoàn đúng phần của phòng đó, **không** `422 E_PAY_REFUND_EXCEEDS_PAID`.

Hiện tượng (F5-QA-04): DLX 2 phòng × 3 đêm, tổng 6.900.000, cọc 2.070.000 bị gán **tuần tự hết cho một** `BookingRoom`, trong khi `cancel-preview`/engine huỷ chia theo **trọng số giá phòng–đêm** (BR-CANCEL-19). Huỷ phòng "còn 0 ₫" ⇒ preview báo hoàn 1.035.000 nhưng lệnh huỷ `422`.

## Căn cứ

- BR-CANCEL-19 ("phân bổ theo trọng số … lưu phân bổ **bất biến**"), BR-CANCEL-05, BR-CANCEL-11, BR-RATE-16; BR-PAY-07
- api.md §3.3 (huỷ một phần theo `bookingRoomIds[]`); QĐ-07 mục 1
- Bằng chứng: `docs/07-ban-giao/bang-chung-f5.md` §3 F5-QA-04; script tái hiện `tests/e2e/f5/sc-partial.mjs`
- Mã: `apps/api/src/modules/pay/**` (ghi `payment_allocations`), `apps/api/src/modules/book/cancel/**` (`refundBase`)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Khi một khoản thu (cọc/số dư) được gán vào `payment_allocations`, phần của mỗi `BookingRoom` chia theo **trọng số giá phòng–đêm** của chính booking đó; `Σ` phần = số tiền khoản thu; phần dư làm tròn VND rải **+1 theo `id` tăng dần**, đúng phép chia `allocatePayment` của domain mà engine huỷ dùng (**QĐ-07 §1 sửa 26/10**: không dồn phòng cuối — `calculateCancellation` từ chối phân bổ khác `allocatePayment` và sẽ tái sinh `422`); không phần nào âm. Booking một phòng giữ nguyên kết quả cũ.
2. `refundBase` của huỷ một phần và **trần hoàn theo phòng** đọc **cùng** phân bổ ⇒ `POST /bookings/{id}/cancel-preview` và lệnh huỷ luôn khớp số; **không** còn `422 E_PAY_REFUND_EXCEEDS_PAID` ở bất kỳ phòng nào.
3. Huỷ lần lượt từng phòng theo **mọi** thứ tự ⇒ tổng hoàn = đã thu − phí (BR-CANCEL-04/05/11); huỷ nốt phòng cuối ⇒ booking `CANCELLED` toàn phần.
4. Phân bổ đã ghi là **bất biến**: thanh toán thêm sau đó (số dư tại quầy) tạo phân bổ mới theo cùng trọng số, **không** sửa dòng phân bổ cũ.
5. Hồi quy không đổi: `apps/api/test/huy-booking`, `chi-hoan`, `so-cai-tien`, `reports`, `thu-tien-tai-quay` xanh.
6. Tái hiện F5-QA-04 bằng `tests/e2e/f5/sc-partial.mjs` trên API thật: xanh, và script **không** phải chọn phòng theo `payment_allocations` để né 422.

## Ngoài phạm vi

- Migration dữ liệu cũ (chỉ có ở dev/seed; ghi TD nếu cần).
- Đổi trọng số của engine huỷ (BR-CANCEL-19 giữ nguyên công thức).
- `POST /quotes/multi-channel` thiếu `roomCount` (TD-51).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · vitest `huy-mot-phan huy-booking chi-hoan so-cai-tien reports thu-tien-tai-quay` · `node tests/e2e/f5/sc-partial.mjs` · **review độc lập Opus trước merge** (QĐ-06 §4).

## Ghi chú cho người làm

Viết test đỏ trước (tái hiện 422 của F5-QA-04) rồi mới sửa. Trọng số phải lấy từ **cùng** nguồn với `refundBase` để hai bên không lệch; nếu chúng đang ở hai hàm khác nhau thì tách một hàm thuần dùng chung thay vì chép công thức (bài học TD-31).
