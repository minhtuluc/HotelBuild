---
id: HB-205
title: Giá booking nhiều phòng — báo giá, giữ chỗ, đặt phòng, walk-in, đổi ngày tính đủ roomCount
risk: R2
owner: codex
max_lines: 600
allow:
  - packages/domain/src/pricing/**
  - packages/domain/test/pricing/**
  - apps/api/src/modules/rate/quotes/**
  - apps/api/src/modules/book/bookings/snapshot.ts
  - apps/api/src/modules/book/reschedule/**
  - apps/api/test/quotes/**
  - apps/api/test/gia-nhieu-phong/**
---

# HB-205 — Giá booking nhiều phòng

## Mục tiêu

Sửa lỗi tiền F7-QA-03: booking `roomCount = N > 1` hiện chỉ thu giá **một** phòng (`quotePrice` cộng mỗi đêm một lần; `planSnapshot` chia `quote.total` của một phòng cho N `BookingRoom`). Sau ticket, mọi đường dùng báo giá (quote, hold, booking, walk-in, đổi ngày) tính đủ N đơn vị theo [QĐ-06](../../05-ke-hoach/nhat-ky/QD-06-lead-tam-me-13.md) mục 1.

## Căn cứ

- BR-BOOK-10 (mỗi đơn vị bán là một BookingRoom), BR-RATE-10, BR-RATE-11, BR-RATE-12, BR-RATE-13, BR-RATE-16, BR-RATE-17; UC-INV-02, UC-BOOK-02; TC-BOOK-17
- Bằng chứng: `docs/07-ban-giao/bang-chung-f7.md` F7-QA-03 (walk-in DLX 2 phòng ra 1.452.000, kỳ vọng 2.904.000; `POST /quotes` roomCount 1/2/3 cùng giá)
- Mã: `packages/domain/src/pricing/index.ts` (`quotePrice`), `apps/api/src/modules/rate/quotes/service.ts`, `apps/api/src/modules/book/bookings/snapshot.ts` (`planSnapshot`), `apps/api/src/modules/book/reschedule/pricing.ts`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Engine nhận số đơn vị bán `units` (= `roomCount`; DOR = số giường): `subtotal = units × Σ nightlyPrice`; `nights[].nightlyPrice` giữ nguyên giá một đơn vị — test `packages/domain/test/pricing/**`.
2. Khuyến mãi `PERCENT`/`AMOUNT` áp **một lần** trên subtotal tổng, thứ tự BR-RATE-13; trần 30% tính trên tổng (BR-RATE-11); sàn = `units × Σ minPrice` (BR-RATE-12); `depositAmount = ceil1000(total × depositPercent)`.
3. `units = 1` cho **đúng từng con số** như trước trên toàn bộ fixture engine hiện có (hồi quy).
4. `ENGINE_VERSION` tăng (`pricing-1.1.0`); quote phát hành bởi bản cũ không tiêu thụ được (đường mismatch/expired hiện có).
5. `POST /quotes` roomCount 1/2/3 → `total` tăng đúng bội số (khi không có khuyến mãi `AMOUNT`) — test `apps/api/test/gia-nhieu-phong/**`.
6. Hold/booking/walk-in N phòng: `bookings.total_amount = quote.total`; Σ phân bổ các `BookingRoom` × đêm = total; snapshot ORIGINAL ghi đủ N phòng.
7. Đổi ngày booking N phòng dùng cùng luật (chênh lệch tính trên tổng N phòng).
8. Tái hiện F7-QA-03 trên API thật: walk-in DLX 2 phòng 1 đêm cùng điều kiện HB-196 ra 2.904.000.

## Ngoài phạm vi

- UI (các app chỉ hiển thị số máy chủ). Nếu màn nào tự cộng `nights[]` thành tổng thì ghi TD, không sửa trong ticket này.
- Sửa dữ liệu booking cũ (chỉ có dữ liệu dev/seed).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` (lead chạy) · `pnpm test:integration` phần `quotes`, `bookings`, `holds`, `doi-ngay`, `huy-booking`, `front-office` (chạy riêng tệp) · **review độc lập Opus trước merge** (QĐ-06 mục 4)

## Ghi chú cho người làm

- Viết test đỏ trước (AC5, AC8) rồi mới sửa engine. Huỷ một phần (BR-CANCEL-19) và báo cáo doanh thu dựa trên phân bổ theo phòng — chạy lại `huy-booking`, `reports` để chắc không lệch.
- Nếu một test hiện có (kể cả test khoá) đang khẳng định hành vi giá một phòng cho N > 1: **dừng, báo lead** — không sửa test khoá.
- `api.md` §3.1 do HB-204 cập nhật; ticket này không sửa `api.md`.
