---
id: HB-278
title: App vận hành khớp operations web — vai nút, chữ theo theme, thanh ngữ cảnh và bảng công việc dạng bảng ga
risk: R1
owner: claude
max_lines: 600
allow:
  - apps/operations-android/**
  - docs/08-thi-cong/tickets/HB-278-app-van-hanh-khop-web.md
unlock:
  - docs/08-thi-cong/tickets/HB-278-app-van-hanh-khop-web.md
---

# HB-278 — App vận hành khớp màn web tương ứng (dự án con E)

> Đặc tả do Claude soạn ngày 20/11/2026; người dùng đã duyệt giữ ranh giới SCR-56…68, không đưa màn quản trị lên điện thoại. **Xếp chồng** lên #361 (HB-274).

## Vấn đề (so với operations web và DESIGN.md)

- **`ActionButton` (73 chỗ dùng):** không bấm được thì làm mờ cả nút (DESIGN.md cấm); bo 6; chữ không dùng font thương hiệu; thiếu vai "nguy hiểm".
- **Chữ:** nhiều ô tự đặt màu nên không dùng font thương hiệu.
- **Màn chính:** chỉ là danh sách thẻ trắng. Operations web có thanh ngữ cảnh (cơ sở đang làm việc, giờ VN, người dùng) và thanh bên dạng bảng ga.
- **Đối soát:** ngày nghiệp vụ in dạng ISO.

## Thay đổi

1. **`src/arrivals/controls-style.ts`:** `actionButtonStyle(tone, disabled, pressed)` ánh xạ sang `buttonStyle` dùng chung:
   - `primary` → mực in, `plain` → viền, `danger` → viền đỏ;
   - không bấm được thì đổi nền, không dùng opacity;
   - nhấn thì xuống 1dp.
   
   `ActionButton` dùng hàm này nên mọi màn đổi theo.
2. **Chữ:** các style màu tự đặt ở 20 file chuyển sang style của theme (font thương hiệu).
3. **Màn chính:**
   - Bảng ga ngữ cảnh: tên cơ sở lấy từ `GET /public/properties` (chưa có thì ghi "Pine Hill", không in id), giờ VN cập nhật mỗi phút, vai trò bằng tiếng Việt.
   - Bảng "Công việc hôm nay" thay danh sách thẻ; giữ nguyên `testID`.
4. **Đối soát:** ngày nghiệp vụ in `dd/MM/yyyy`.

## Tiêu chí nghiệm thu

1. Test mới đỏ trước khi sửa:
   - `controls-style.spec.ts`: vai nút; không bấm được thì không làm mờ; vùng chạm; nhấn.
   - `context-bar.spec.ts`: giờ VN; đủ nhãn vai trò; chưa có tên cơ sở thì không in id; màn chính có hai bảng ga.
2. App vận hành: tsc, eslint, vitest (424 test) xanh.
3. Máy thật (20/11, lễ tân):
   - Màn chính hiện "PINE HILL ĐÀ LẠT · 21:28 GIỜ VN · LỄ TÂN" và bảng công việc.
   - Màn đối soát có nút kiểu viền và ngày `20/11/2026`.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
