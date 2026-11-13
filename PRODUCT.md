# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Bản ghi này phủ hai web app `apps/customer-web` và `apps/operations-web`. Hai app Android dùng chung token qua `packages/ui-native`, chưa nằm trong đợt đại tu giao diện 11/2026.)

## Users

- **Khách đặt phòng trực tiếp** (ACT-01): người Việt đi du lịch nội địa, đặt từ điện thoại hoặc laptop, thường so giá với Booking.com / Agoda trước khi quyết định. Việc của họ: chọn cơ sở + ngày + số khách, thấy giá từng đêm và chính sách huỷ, giữ chỗ, đặt cọc qua VNPay/MoMo, sau đó tra cứu, đổi ngày hoặc huỷ đơn.
- **Đội vận hành tại cơ sở**: lễ tân (FRONT_DESK), buồng phòng (HOUSEKEEPING), quản lý cơ sở (MANAGER), kế toán, chủ chuỗi (OWNER), quản trị hệ thống. Họ làm ca dài trước màn hình quầy, xử lý khách đến/đi trong ngày, lưới tồn phòng, giá theo mùa/kênh, quá tải và hoàn tiền.

## Product Purpose

Một nguồn tồn phòng và giá duy nhất cho chuỗi Pine Hill, thay sổ tay và Excel rời rạc ở từng cơ sở. Thành công là: không bán quá phòng, hai nhân viên luôn báo cùng một giá, khách biết chính xác mình được hoàn bao nhiêu nếu huỷ, và chủ chuỗi thấy được kênh nào thực sự sinh lời.

## Positioning

Pine Hill bán trực tiếp với **giá tính theo từng đêm minh bạch** (hệ số mùa, cuối tuần, công suất, độ dài lưu trú, kênh) và **chính sách huỷ theo mốc giờ trước 14:00 ngày nhận phòng**, hoàn trên số tiền đã thực trả. Đây là thứ OTA không cho khách thấy: khách đặt trực tiếp thấy cách tính, không chỉ con số cuối.

## Operating Context

- Chuỗi **3 cơ sở, 55 phòng**. Tên/địa điểm cơ sở đến từ API (seed dev: Đà Lạt, Vũng Tàu, Phan Thiết; fake API E2E: Đà Lạt, Nha Trang, Vũng Tàu). Giao diện không được ghi cứng tên hay số liệu cơ sở.
- Loại phòng seed: Standard (2 khách, 650.000 ₫), Superior (2, 850.000 ₫), Deluxe (3, 1.100.000 ₫), Family (4, 1.600.000 ₫), Dorm bán theo giường (250.000 ₫/giường). Là chuỗi homestay–khách sạn tầm trung, có dorm và ghép phòng; không phải resort sang trọng.
- 7 kênh bán: web trực tiếp, điện thoại, khách vãng lai, OTA (Booking.com, Agoda, Airbnb) qua webhook, đại lý.
- Giữ chỗ 10 phút, báo giá hiệu lực 15 phút, giao dịch 15 phút, hạn xử lý quá tải T−24h: đều là đồng hồ đếm ngược người dùng phải thấy.
- Vận hành theo vai trò và `propertyScope`; nhân viên chọn cơ sở đang làm việc một lần cho cả phiên.

## Capabilities and Constraints

- Nguồn chân lý nghiệp vụ: `docs/02-nghiep-vu/quy-tac-nghiep-vu.md`. Danh mục 83 màn hình và quy tắc UI-01..UI-18: `docs/04-thiet-ke/thiet-ke-man-hinh.md`.
- Frontend không chứa luật giá, policy, phân quyền hay trạng thái nghiệp vụ; mọi con số do máy chủ trả.
- Tiền là VND số nguyên, phân cách nghìn bằng dấu chấm, hậu tố `₫`, `tabular-nums`. Thời gian hiển thị giờ VN.
- Mọi thao tác tài chính xác nhận hai bước; hành động nguy hiểm tách xa hành động thường.
- Trạng thái không truyền đạt chỉ bằng màu (9 trạng thái ô lưới có ký hiệu riêng).
- Chạy được offline/mạng nội bộ: font đóng gói cục bộ, không phụ thuộc CDN.
- `data-testid`, `role`, `aria-*` và khoá i18n hiện có là hợp đồng của bộ test E2E; giữ nguyên.

## Brand Commitments

- Tên: **Pine Hill**. Tiếng Việt là ngôn ngữ chính của giao diện.
- Không có logo, ảnh hay bộ nhận diện chính thức nào được cung cấp. Bản dựng 11/2026 buổi sáng mượn ảnh, font Lyon Display và bố cục từ website Amanoi (Aman): đó là tài sản bản quyền của bên khác, **không được dùng** và không phải nhận diện của Pine Hill.

## Evidence on Hand

- Không có ảnh thật của các cơ sở. Không có đánh giá, giải thưởng, số liệu diện tích/khoảng cách thật. Mọi con số "31 pavilion", "29.000 hecta", "75′ từ sân bay" trong bản dựng cũ là bịa và phải gỡ.
- Dữ liệu thật có sẵn qua API: danh sách cơ sở, loại phòng, sức chứa, giá từng đêm, gói giá, chính sách huỷ, khuyến mãi đang chạy.

## Product Principles

1. **Tìm phòng là việc đầu tiên.** Khối chọn cơ sở / ngày / số khách là nội dung chính của trang đầu, không phải phần phụ dưới ảnh.
2. **Cho thấy cách tính, không chỉ kết quả.** Giá từng đêm, bậc huỷ, số tiền hoàn và đồng hồ giữ chỗ luôn hiện ra trước khi khách phải cam kết.
3. **Không bịa.** Không số liệu, ảnh hay lời quảng cáo nào mà dữ liệu thật không chứng minh được.
4. **Công cụ vận hành biến mất vào công việc.** Màn quầy ưu tiên mật độ, quét nhanh, trạng thái rõ; không trang trí, không lộ mã nội bộ (SCR, BR, NFR) cho nhân viên.
5. **Một phiên, một cơ sở.** Ngữ cảnh cơ sở chọn một lần và áp cho mọi màn, không bắt nhập lại.

## Accessibility & Inclusion

WCAG 2.1 AA: tương phản ≥ 4,5:1, chữ ≥ 12px (số tiền ≥ 14px), vùng chạm ≥ 44px trên web, đủ thao tác bàn phím (Tab theo thứ tự thị giác, Esc đóng hộp thoại, mũi tên trong lưới tồn), tôn trọng `prefers-reduced-motion`.
