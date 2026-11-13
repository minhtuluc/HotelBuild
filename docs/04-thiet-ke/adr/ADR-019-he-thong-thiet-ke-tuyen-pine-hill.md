# ADR-019 — Hệ thống thiết kế "Tuyến Pine Hill" cho bốn frontend

**Trạng thái:** Đã chấp nhận (sửa 13/11/2026, thay bản "Pine Hill–Amanoi" cùng ngày) · **Ngày:** 11/2026 · **Liên quan:** BR-GEN-01, BR-INV-01, NFR-USE-01, NFR-USE-02, NFR-LOC-01, NFR-MAIN-02, [ADR-018](ADR-018-backend-chung-bon-frontend.md), [thiet-ke-man-hinh.md](../thiet-ke-man-hinh.md), [DESIGN.md](../../../DESIGN.md)

## Bối cảnh

Theo [ADR-018](ADR-018-backend-chung-bon-frontend.md), Pine Hill có bốn frontend phục vụ hai nhóm người dùng:

1. **Khách đặt phòng** (`apps/customer-web`, `apps/customer-android`): khách nội địa đặt trực tiếp ở chuỗi homestay–khách sạn tầm trung 3 cơ sở, 55 phòng, thường so giá với OTA. Điều Pine Hill làm được mà OTA không cho khách thấy là giá tính theo từng đêm và mốc hoàn tính theo giờ (BR-GEN-01, BR-INV-01).
2. **Đội vận hành** (`apps/operations-web`, `apps/operations-android`): lễ tân, quản lý, kế toán, chủ chuỗi làm ca dài, cần mật độ thông tin, bảng thẳng cột, vùng chạm 44px web và 48dp Android (NFR-USE-01, NFR-USE-02).

Bản dựng đầu (cùng ngày) mượn bố cục, ảnh và font Lyon Display của website Amanoi (Aman). Phương án đó bị loại vì: tài sản thuộc bản quyền bên khác; số liệu trên trang bịa theo một resort khác; và hình ảnh resort sang trọng lệch với sản phẩm thật (homestay tầm trung, có phòng dorm).

## Quyết định

Một bộ token chung (`@pinehill/ui-web`, `@pinehill/ui-native`) cho thế giới **"Tuyến Pine Hill"**: ba cơ sở là ba ga, mỗi đêm là một chặng có giá in riêng, huỷ là trả vé theo giờ.

1. **Ba vật liệu**, đạt WCAG 2.1 AA (kiểm trong `packages/ui-web/test/tokens.spec.ts`):
   - Giấy vé hồng `#F0C2B3` cho form, vé mẫu, dải giá; chữ phụ trên vé `#6B2F22`, đỏ hành động trên vé `#962A16`.
   - Bảng ga `#121614` chữ hổ phách `#F2B632`, xanh còn chỗ `#7CD08A`.
   - Nền giấy mẫu biểu `#DFE5F0` cho trang khách; nền làm việc `#F3F2EE` cho back-office.
   - Mực in xanh `#1B3A82` (liên kết, hành động back-office, tiêu điểm), đỏ dấu bấm `#B8341C` (hành động phía khách).
2. **Chữ đóng gói cục bộ (OFL), đủ dấu tiếng Việt** (NFR-LOC-01): Be Vietnam Pro 400–700 cho chữ thân; Barlow Condensed 500/600 cho tiêu đề, bảng ga, số. Không dùng font thương mại.
3. **Hai mức biểu đạt trên cùng token:**
   - Trang khách: thế giới đầy đủ (bảng ga, tấm vé là form tìm phòng, áp phích ga, bảng trả vé).
   - Back-office: chỉ mượn màu, chữ và một dấu ấn (thanh bên bảng ga, mục đang mở là tấm vé, đồng hồ giờ VN); bố cục, điều hướng, control theo chuẩn ứng dụng web.
4. **Một nguồn chân lý:** `tokens.ts` sinh biến CSS (`tokensToCssVariables()`, gồm `--color-world-*`); khoảng cách và bán kính sinh kèm đơn vị `px`. Quy tắc chi tiết ở [DESIGN.md](../../../DESIGN.md).

## Phương án đã cân nhắc

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|---|---|---|---|
| "Tuyến Pine Hill" (vé tàu) | Mọi màn trong luồng đặt phòng có vật tương ứng (vé, chặng, cuống, ví vé, bảng điều độ); nói đúng cơ chế giá từng đêm và mốc hoàn theo giờ | Bảng ga dễ thành dashboard tối màu nếu dùng quá tay | **Chọn** |
| Bản sao Amanoi (bản đầu) | Đẹp sẵn | Vi phạm bản quyền; lệch sản phẩm thật | Loại |
| Tem và dấu bưu điện | Hợp với trạng thái đơn kiểu tra cứu bưu phẩm | Ít gợi chuyện đi chơi; lần dựng đầu chỉ thành viền trang trí | Loại |
| Tranh tứ bình Đông Hồ | Bản sắc mạnh, hợp giá theo mùa | Khó gánh màn dày dữ liệu và back-office | Loại (có thể dùng làm tranh theo mùa) |
| Chuẩn ngành (kiểu OTA) | Quen thuộc | Không phân biệt với đối thủ; cần ảnh thật chưa có | Loại |

## Hệ quả

- **Tích cực:** khách thấy giá từng đêm và mốc hoàn ngay ở trang chủ; bốn frontend chung một nhận diện; không phụ thuộc tài sản bên ngoài.
- **Tiêu cực:** cần ảnh thật của từng cơ sở (ô ảnh và brief ở [anh-trang-khach.md](../anh-trang-khach.md)); bảng trả vé trên trang chủ chép từ chính sách hiện hành nên phải sửa cùng lúc khi chính sách đổi.

## Cổng nghiệm thu

1. `packages/ui-web/test/tokens.spec.ts` và `packages/ui-native/test/ui-native.spec.ts`: mọi cặp chữ/nền và 9 ô `gridStatus` ≥ 4,5:1.
2. `packages/ui-web/test/states.spec.tsx`, `panels.spec.tsx`, `brand.spec.tsx`: 0 vi phạm `axe-core`.
3. `impeccable detect` trên trang khách đang chạy: 0 lỗi.
