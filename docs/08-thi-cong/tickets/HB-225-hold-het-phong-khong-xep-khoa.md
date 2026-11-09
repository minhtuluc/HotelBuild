---
id: HB-225
title: Giữ chỗ khi kỳ đã hết phòng trả 409 ngay, không xếp hàng trên khoá ADR-014 (TD-17, AC4 HB-076 đỏ chập chờn)
risk: R1
owner: claude
max_lines: 250
allow:
  - apps/api/src/modules/book/holds/availability.ts
  - apps/api/src/modules/book/holds/service.ts
  - apps/api/test/holds/sold-out-fast.spec.ts
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-225-hold-het-phong-khong-xep-khoa.md
---

# HB-225 — Hold hết phòng không xếp hàng trên khoá

## Vấn đề

`apps/api/test/holds/holds.spec.ts` › AC4 (200 lệnh `POST /holds` song song giành một đơn vị cuối, pool 50) có hai chế độ trên CI:

- Thường 12–23 giây.
- Thỉnh thoảng 150 giây và đỏ với 114 lệnh `500 E_GEN_SERVICE_UNAVAILABLE` sau 12 lần thử (run 42415079905), hoặc timeout 240 giây (#266, #267, #270, #272).

## Nguyên nhân gốc

`HoldsService.create` khoá `properties → room_types → rooms` (ADR-014) **trước** khi kiểm tồn. Vì vậy mỗi lệnh thua cũng giữ một connection pool để chờ khoá, rồi kiểm tồn tuần tự sau lệnh thắng. Khi CI chậm, hàng đợi khoá vượt `timeout` 10 giây của transaction và trả 500. Client thử lại bằng khoá mới, xếp hàng lại từ đầu, nên hàng đợi không bao giờ rút: hệ rơi vào trạng thái sụp đổ "metastable". Ở production, kiểu dồn tải này xảy ra khi nhiều khách cùng giành phòng cuối của một ngày cao điểm (TD-17).

## Thay đổi

`holds/availability.ts::soldOutBeforeLock` chạy trước `lockStock`. Hàm đọc tồn bằng chính engine HB-032 / loader, ở chế độ `READ COMMITTED` không khoá:

- Nếu đã hết chỗ ⇒ `409 E_INV_NO_AVAILABILITY` ngay. Trạng thái đã commit cho thấy không đủ phòng, nên câu trả lời đúng tại thời điểm đọc.
- Nếu còn chỗ ⇒ vẫn đi đường có khoá và kiểm lại sau khoá như cũ. Quyết định bán vẫn chỉ đến từ kiểm tồn sau khoá.
- Loại phòng lạ hoặc vượt sức chứa ⇒ không kết luận ở bước sớm, để giữ đúng thứ tự mã lỗi (`404`, `422`) của đường có khoá.

## Tiêu chí nghiệm thu

1. Kỳ hết phòng và một phiên khác đang giữ khoá `properties` ⇒ 409 `E_INV_NO_AVAILABILITY` dưới 3 giây. Test: `apps/api/test/holds/sold-out-fast.spec.ts::HB225_sold_out_hold_answers_409_without_waiting_for_the_property_lock` (đỏ trước khi sửa: chờ đến khi khoá nhả).
2. Kỳ còn phòng vẫn chờ khoá rồi mới quyết định (201 sau khi khoá nhả). Test: `…::HB225_available_hold_still_waits_for_the_lock_before_deciding`.
3. `holds.spec.ts` giữ nguyên, xanh. AC4 vẫn đúng 1 thắng / 199 lệnh `409`; thời gian local giảm từ 12,5–22,5 s xuống 1,7–2,2 s.

## Ngoài phạm vi

Không đổi `maxWait`/pool của `IdempotencyStore` (phần còn lại của TD-17, đo ở k6 HB-184). Không đổi luồng `POST /bookings` hay walk-in.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api` đầy đủ.
