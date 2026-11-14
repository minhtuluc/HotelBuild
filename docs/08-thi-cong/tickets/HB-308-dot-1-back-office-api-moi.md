---
id: HB-308
title: Đợt 1 frontend — SCR-23 bảng ngày (TD-09), SCR-27 sửa/ngừng mùa (TD-06), SCR-29 sửa/tắt khuyến mãi (TD-08), cơ sở đang làm việc (TD-44 một phần), gỡ nhãn minh hoạ trang demo
risk: R1
owner: claude
max_lines: 3000
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - apps/customer-web/src/**
  - tests/e2e/operations-web/**
  - tests/e2e/a11y/fixtures.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/07-ban-giao/no-ky-thuat.md
  - docs/08-thi-cong/tickets/HB-308-dot-1-back-office-api-moi.md
unlock:
  - docs/08-thi-cong/tickets/HB-308-dot-1-back-office-api-moi.md
---

# HB-308 — Đợt 1 frontend: nối API back-office vừa mở khoá

> Đặc tả do frontend lead soạn theo [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (đợt 0 + đợt 1). Thiết kế theo [DESIGN.md](../../../DESIGN.md) và [ADR-019](../../04-thiet-ke/adr/ADR-019-he-thong-thiet-ke-tuyen-pine-hill.md).

## Vấn đề

Backend đã có `GET /operations/day-board` (HB-242), `PUT /seasons/{id}` (HB-241), `PUT /promotions/{id}` (HB-240) và `api-client` tương ứng, nhưng giao diện vận hành vẫn:

- SCR-23 hiện khối "Các dữ liệu chưa hỗ trợ" cho đến / đi / ở, ca quá tải, kênh lỗi đồng bộ;
- SCR-27 và SCR-29 chỉ tạo và xem, không sửa hay ngừng được;
- SCR-23 và SCR-27 tự chọn cơ sở đầu tiên thay vì cơ sở đang làm việc của phiên (TD-44).

Trang chủ khách còn dòng chú thích "ảnh và mô tả là minh hoạ" và hậu tố "ảnh minh hoạ" trong mô tả ảnh; bản demo cho khách không nên hiện các nhãn này (chủ dự án quyết định 13/11/2026; rà lại trước ngày phát hành công khai).

## Thay đổi

1. **SCR-23** (`day-board/`):
   - Tải bảng ngày song song với lưới tồn; kiểm khớp cơ sở và ngày, số dòng không vượt `total`.
   - Dải tóm tắt kiểu bảng ga (đến, đi, đang ở, ca quá tải đêm nay, kênh lỗi), mỗi ô là link tới nhóm hoặc màn tương ứng.
   - Ba bảng khách: chưa làm thủ tục lên đầu, mã đơn link sang chi tiết booking, còn phải thu. Trên màn hẹp mỗi đơn thành một thẻ.
   - Danh sách bị cắt ở 200 dòng thì ghi "Đang hiện n/total".
   - Lỗi riêng của bảng ngày không xoá tồn khả dụng. 403 (RESERVATION_AGENT xem được tồn nhưng không xem được danh sách khách) chỉ ẩn phần này; 401 vẫn che cả màn.
2. **Sửa / ngừng cấu hình giá dùng chung** (`lib/config-edit.ts`, `components/config-edit-panel.tsx`, `components/use-config-edit.ts`):
   - Chỉ gửi trường đổi; không đổi gì thì báo "Chưa có trường nào thay đổi" và không gọi API.
   - Lý do bắt buộc (1–500 ký tự); `If-Match` theo phiên bản đang xem.
   - Lỗi ghi báo ngay trong khung sửa, không thay cả màn: 403 "chỉ chủ chuỗi", 409/412 "vừa được người khác sửa" kèm nút tải lại, 400/422 theo trường, lỗi khác "chưa rõ đã lưu" kèm mã tham chiếu.
3. **SCR-27:**
   - Cột trạng thái; OWNER có nút Sửa và Ngừng/Bật lại (nút ngừng là `.ph-btn-danger`).
   - BFF `PUT /api/session/sys/seasons/{id}`.
4. **SCR-29:**
   - Sửa mức giảm, đêm tối thiểu, lượt tối đa (để trống = bỏ giới hạn, không hạ dưới số đã dùng), hiệu lực theo giờ VN, phạm vi kênh/loại phòng, cộng dồn.
   - Tắt/Bật lại.
   - BFF `PUT /api/session/sys/promotions/{id}`.
5. **TD-44 (một phần):**
   - SCR-23 và SCR-27 mở ở cơ sở đang làm việc nếu cơ sở đó có trong danh sách máy chủ trả, và đi theo khi đổi trên thanh ngữ cảnh.
   - `pickId` của SCR-27 không còn nhận id ngoài danh sách.
6. **CSS vận hành:** `.ph-day-*`, `.ph-check`, `.ph-check-group`, `.ph-edit-fields`. Ô tick trong hàng bộ lọc không còn bị kéo giãn 100%; ô ngày giờ đủ rộng.
7. **Trang khách:** bỏ dòng chú thích minh hoạ và hậu tố "ảnh minh hoạ" trong `alt`. Nguồn ảnh vẫn ghi ở `docs/04-thiet-ke/anh-trang-khach.md`.
8. **Sửa hồi quy từ #298 (SCR-70):** câu giới thiệu gói giá mất "(BR-RATE-16,20)" nên chứa nguyên văn dòng cảnh báo snapshot, E2E `rate-plans.spec.ts` (AC7) khớp hai phần tử. Viết lại câu giới thiệu, giữ nguyên test.

## Tiêu chí nghiệm thu

1. Unit test mới: `day-board-groups.spec.ts`, `season-edit.spec.ts`, `promotion-edit.spec.ts`; toàn bộ unit test operations-web và customer-web đạt.
2. E2E Playwright:
   - `operations-web/day-board.spec.ts`: bảng ngày lấy số từ máy chủ, khách chưa nhận phòng lên đầu, 403 chỉ ẩn danh sách khách.
   - `seasons.spec.ts`: chỉ gửi trường đổi kèm `If-Match`, thiếu lý do / không đổi thì không gọi API, ngừng mùa, xung đột và 403 báo trong khung, MANAGER không thấy nút.
   - `promotions.spec.ts`: gia hạn theo giờ VN, chặn hạ lượt tối đa, tắt sớm, xung đột, MANAGER không thấy nút.
   - axe không lỗi serious/critical; không cuộn ngang ở 360 px.
3. Typecheck, lint (`complexity`, `max-lines`) đạt; không có cast `as` mới.
4. Không có quy tắc giá, tồn hay phân quyền mới ở frontend: số đếm, mùa thắng và quyền sửa đều do máy chủ quyết. Nút sửa chỉ ẩn với vai trò khác OWNER để gợi ý; máy chủ vẫn chặn.

## Ngoài phạm vi

- TD-44 cho các màn còn lại (ghi trong sổ nợ kỹ thuật).
- Đổi test khoá SCR-12 (đợt 2, cùng HB-309 i18n).
