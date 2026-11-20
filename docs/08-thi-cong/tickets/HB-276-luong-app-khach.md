---
id: HB-276
title: Luồng đặt phòng app khách khớp web — 3 bước, chọn ga dạng bảng ga, chọn nhanh số đêm, chặng giá trên giấy vé
risk: R1
owner: claude
max_lines: 900
allow:
  - apps/customer-android/**
  - packages/ui-native/src/components/primitives.tsx
  - docs/08-thi-cong/tickets/HB-276-luong-app-khach.md
unlock:
  - docs/08-thi-cong/tickets/HB-276-luong-app-khach.md
---

# HB-276 — Luồng và bố cục app khách (dự án con C)

> Đặc tả do Claude soạn ngày 20/11/2026; người dùng đã duyệt chia dự án con. **Xếp chồng** lên #362 (HB-275).

## Vấn đề (so với web khách và DESIGN.md)

- Hành trình không có bước. Web in "Bước n/3".
- Cơ sở là danh sách nút trắng. Web là bảng ga đen chữ hổ phách.
- Ô ngày gõ `YYYY-MM-DD` mà không thấy thứ/ngày. Web có dòng ngày và nút chọn nhanh 2/3/5 đêm (HB-317).
- Giá từng đêm là thẻ trắng ghi ngày ISO. Web in mỗi đêm là một chặng trên giấy vé.
- "Tiếp tục xác nhận" là link chữ. DESIGN.md quy định bước cam kết dùng nút dấu bấm cỡ lớn.
- Nhiều ô chữ tự đặt màu nên không dùng font thương hiệu (thấy trên máy thật sau HB-273).

## Thay đổi

1. **`src/journey.ts`** (logic thuần): `QUICK_NIGHTS` (2/3/5), `withNights`, `activeNights`, `todayVn`, `stayDateLine`.
2. **Tìm phòng:**
   - Bước 1/3.
   - Chọn cơ sở bằng `Board`/`BoardRow` (vai `radio`, nhãn trợ năng giữ nguyên).
   - Dòng ngày dưới ô nhận/trả.
   - Nút chọn nhanh số đêm.
3. **Chi tiết phòng:**
   - Bước 2/3; kỳ ở in theo định dạng ngày.
   - Mỗi đêm là một chặng trên `Ticket`: nhãn "Chặng n", thứ + ngày, giá cơ bản, giá đêm. Đêm chạm sàn/trần dùng viền chấm, như web.
   - "Tiếp tục xác nhận" là `Button` dấu bấm cỡ lớn.
4. **Xác nhận:** bước 3/3; tóm tắt kỳ ở trên giấy vé.
5. **Chữ:** các style màu tự đặt chuyển sang style của theme (font thương hiệu) ở 9 file.
6. **`BoardRow`:** thêm `choice` (vai `radio`) và `accessibilityLabel`.
7. **Câu chữ mới** (bước, chọn nhanh, chặng, tóm tắt) có đủ 6 ngôn ngữ, dùng y nguyên bản dịch của web.

## Tiêu chí nghiệm thu

1. `test/journey.spec.ts` (đỏ trước khi sửa): chọn nhanh số đêm, nút đang chọn, hôm nay theo giờ VN, dòng ngày vi/en.
2. `routes.spec.ts`: ba màn có bước; có `QuickNights`; có chặng trên giấy vé; có nút cam kết; không còn chữ tự đặt màu.
3. App khách: tsc, eslint, vitest (167 test) xanh. `ui-native`: 33 test.
4. Máy thật: **chưa chạy** vì điện thoại rớt USB giữa phiên. Sẽ kiểm khi máy cắm lại.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci`
