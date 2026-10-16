---
id: HB-199
title: Kiểm phạm vi áp dụng của mã khuyến mãi khi dựng dữ kiện giá
risk: R1
owner: deepseek
max_lines: 400
allow:
  - apps/api/src/modules/rate/pricing-facts/**
  - apps/api/test/rate/**
---

# HB-199 — Kiểm phạm vi áp dụng của mã khuyến mãi

> Ticket nhỏ do người thay vai lead cấp (backlog F8–F9 để dành `HB-198`, `HB-199`). Nguồn: lỗi **P1** reviewer nêu ở
> PR #132 (HB-074) + quan sát ngoài phạm vi ở PR #131 (HB-198).

## Mục tiêu

Bảng `promotions` có các cột phạm vi áp dụng (`minNights`, `channelScope`, `roomTypeScope`, cửa sổ ngày…) nhưng
**engine `@pinehill/domain/pricing` không mang các trường đó** (`type Promotion` của domain không có), nên hiện một mã
khuyến mãi dành cho **kênh khác / loại phòng khác / kỳ chưa đủ đêm / ngoài cửa sổ** vẫn có thể được áp và **giảm giá
sai**. Vì `packages/**` bị khoá, chỗ thực thi đúng là **loader** — nơi duy nhất đọc được bảng khuyến mãi.

## Căn cứ

- BR-RATE-14 (mã khuyến mãi), BR-RATE-17 (cùng đầu vào ⇒ cùng giá), api.md §3.1 và bảng mã lỗi §5
- `docs/04-thiet-ke/csdl.md` §3 — bảng `promotions` (đọc **cột thật** trước khi làm)
- `modules/rate/pricing-facts/loader.ts` (HB-056 + HB-198, đã có `assertPromotionsInCatalogue`)
- Phụ thuộc: HB-052 (engine), HB-056 (loader), HB-198 (gộp loader) — đều đã có trên `main`

## Tiêu chí nghiệm thu

1. Loader **lọc/kiểm phạm vi áp dụng** của từng mã trước khi đưa vào dữ kiện cho engine: ít nhất `minNights`,
   `channelScope`, `roomTypeScope`, và cửa sổ ngày nếu bảng có — dùng **đúng cột thật** trong `csdl.md` §3 (nêu rõ
   trong PR đã dùng cột nào, cột nào không tồn tại nên bỏ qua).
2. Mã **không áp dụng được cho đầu vào cụ thể** (sai kênh, sai loại phòng, chưa đủ số đêm, ngoài cửa sổ): đọc kỹ
   api.md §3.1 + BR-RATE-14 để chốt **mã lỗi hay chỉ không giảm giá**, và ghi rõ cách đọc trong PR. Mã **không có trong
   danh mục** giữ nguyên hành vi HB-198 (⇒ `422 E_RATE_PROMO_INVALID`).
3. **Không sửa `packages/**`.** Nếu thấy buộc phải thêm dữ liệu vào type của domain ⇒ **dừng và báo lead**.
4. Test: ca sai kênh / sai loại phòng / dưới `minNights` / ngoài cửa sổ / mã hợp lệ (vẫn giảm giá đúng) — chạy ở ranh
   giới loader trên CSDL thật. **Số ca không giảm**; không nới/xoá ca cũ.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`

## Ghi chú cho người làm

Đây là chỗ **duy nhất** trong hệ thống có đủ dữ liệu để chặn giảm giá sai; engine không sửa được (khoá `packages/**`).
Nếu phát hiện cột phạm vi nào **chưa từng được dùng** ở đâu (kể cả tài liệu), ghi rõ để lead quyết thay vì tự suy diễn.
