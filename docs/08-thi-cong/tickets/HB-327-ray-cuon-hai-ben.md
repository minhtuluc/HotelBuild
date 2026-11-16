---
id: HB-327
title: Trang chủ trên màn rộng dùng hai lề trống làm đường ray bám cuộn (trái) và cuống vé bấm lỗ (phải)
risk: R0
owner: claude
max_lines: 650
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr92-ray-cuon-hai-ben.spec.ts
  - docs/08-thi-cong/tickets/HB-327-ray-cuon-hai-ben.md
unlock:
  - docs/08-thi-cong/tickets/HB-327-ray-cuon-hai-ben.md
---

# HB-327 — Đường ray bám cuộn ở hai lề trang chủ

> Đặc tả do frontend lead soạn. Chủ dự án giao ngày 16/11/2026. Chồng trên HB-326.

## Vấn đề

- Dải nội dung trang chủ rộng tối đa 1240 px. Ở màn 1920 px, mỗi bên còn khoảng 330 px để trống.
- Mẫu tham chiếu `Impeccable/villa-castagneto-gallery` (mẫu 01, 02) dùng lề trái làm một dụng cụ đo bám cuộn (thước độ cao), lề phải làm khung bản đồ. Lề trở thành một phép đo, không chỉ là khoảng trắng.

## Thay đổi

0. **Hai lề là cột mảnh của trang, không phải lớp phủ.** Từ 1400 px, phần thân trang (`main`) chừa hai cột lề rộng bằng nhau (56 px); header và footer vẫn tràn hết khung. Hai cột không có nền hay viền riêng: chúng để lộ nền giấy mẫu biểu của trang, liền với nền hero. Cột dính theo cuộn (`sticky`), nên bắt đầu dưới header và dừng trên footer.
1. **Lề trái là đường ray.** Một nét mực mảnh, sáu chấm ga ứng với sáu dải của mục lục trang chủ (`HOME_TOC`). Tên ga in chữ dọc chạy dọc theo ray, từ dưới chấm ga tới gần ga kế; chỉ hiện ga đang đọc và ga đang trỏ chuột/focus, các tên khác ẩn bằng độ mờ nhưng vẫn là tên truy cập của link. Nhờ vậy cột chỉ cần 56 px. Đầu tàu trượt nội suy giữa hai ga theo vạch đọc (một phần ba màn hình), giống cách mẫu 01 nội suy độ cao; đoạn đã đi qua đậm lên thành mực xanh. Phía trên là số đọc xếp chồng `03` trên `06`. Mỗi ga là link neo, vùng bấm 44 × 44 px, có `aria-current`.
2. **Lề phải là hàng lỗ bấm vé.** Soi gương với lề trái: cùng nét mực, cùng khoảng cách tới mép, sáu lỗ thẳng hàng với sáu ga, tên tuyến in dọc ở vị trí số đọc. Dải nào đã đi qua thì lỗ được bấm (chấm đỏ dấu bấm, màu nhấn duy nhất của hai lề). Chỉ trang trí: `aria-hidden`.
3. **Ngưỡng:** hai lề chỉ hiện khi khung rộng từ 1400 px (đủ chỗ cho hai cột 56 px mà dải nội dung vẫn rộng đủ 1240 px), nên màn laptop 1440 px cũng có. Hẹp hơn thì ẩn hẳn, giữ dải mục lục ngang hiện có (HB-325). Từ 1400 px, dải mục lục ngang ẩn để không có hai mục lục.
4. Không thêm chuỗi dịch: nhãn ga dùng lại nhãn mục lục, số đọc chỉ là số.
5. `prefers-reduced-motion`: đầu tàu nhảy, không trượt. Không in khi in trang.

## Tiêu chí nghiệm thu

1. Vị trí đầu tàu nội suy đúng giữa hai ga, kẹp ở hai đầu — test: `apps/customer-web/test/content/scroll-rails.spec.ts`
2. 1440 px: đường ray và cuống vé hiện, dải mục lục ngang ẩn; bấm ga "Trả vé" nhảy tới `#tra-ve`, ga đó có `aria-current`, bốn lỗ đầu đã bấm — test: `tests/e2e/scr92-ray-cuon-hai-ben.spec.ts`
3. 1280 px và 360 px: hai lề ẩn, dải mục lục ngang hiện, không cuộn ngang — cùng file e2e.

## Ngoài phạm vi

- Các trang khác (trang ga, trang hạng). Làm sau nếu trang chủ ổn.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` · `pnpm test:e2e`
