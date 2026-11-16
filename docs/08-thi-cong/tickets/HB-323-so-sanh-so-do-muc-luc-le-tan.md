---
id: HB-323
title: So sánh năm hạng (FEAT-05), sơ đồ hai chiều tuyến ↔ ga và mặt cắt năm khoang (UX-02), mục lục bám cuộn trang ga (UX-06), nhịp nền xen kẽ (UX-07), liên hệ lễ tân khi lỗi mạng (P6)
risk: R1
owner: claude
max_lines: 2000
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr89-so-sanh-so-do-muc-luc-le-tan.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-323-so-sanh-so-do-muc-luc-le-tan.md
unlock:
  - docs/08-thi-cong/tickets/HB-323-so-sanh-so-do-muc-luc-le-tan.md
---

# HB-323 — So sánh hạng, sơ đồ hai chiều, mục lục, liên hệ lễ tân

> Đặc tả do frontend lead soạn theo §8 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md). Chủ dự án giao ngày 15/11/2026: FEAT-05, UX-02, UX-06, UX-07, và P6 theo đề xuất "chỉ hiện liên hệ lễ tân". Chồng trên HB-311b (#324).

## Vấn đề

- Nhóm ba, bốn người hoặc người đi một mình phải mở từng trang hạng để chọn giữa SUP, DLX, FAM, DOR.
- Sơ đồ tuyến và thẻ ga trên trang chủ đứng tách rời. Năm hạng không có hình nào cho thấy khác nhau ở số chỗ ngủ.
- Trang ga dài năm, sáu dải mà không có chỗ báo đang đọc tới đâu. Nhiều dải liền nhau cùng một nền.
- Khi lỗi mạng ở bước báo giá hay điền thông tin, khách chỉ có nút "Thử lại".

## Thay đổi

1. **FEAT-05 — bảng so sánh năm hạng** trên `/room-types/[code]`, thay danh sách "Các hạng khác".
   - Cột: hạng (link), khoang, sức chứa, số chỗ ngủ (seed `bedCount`), bán theo phòng hay giường, hợp với ai.
   - Chỉ thuộc tính có nguồn; không diện tích, không phòng tắm riêng/chung (chưa có nguồn).
   - Hàng đang xem đánh dấu `aria-current`. Dưới 640 px mỗi hàng thành một thẻ.
2. **UX-02:**
   - Trang chủ: rê chuột hoặc focus vào ga trên sơ đồ tuyến thì thẻ ga tương ứng nổi viền, và ngược lại.
   - Mặt cắt năm khoang trên dải hạng phòng: mỗi khoang vẽ đúng số chỗ ngủ; Dorm ghi bán theo giường; không vẽ cách kê giường (§8.2).
   - Phím Tab vào nhóm, mũi tên chuyển khoang, chọn khoang thì hàng hạng tương ứng nổi viền và dòng tóm tắt `aria-live` đổi theo.
   - Làm theo kiểu tăng cường dần: không JS thì sơ đồ vẫn đọc được.
3. **UX-06:** mục lục bám cuộn trên trang ga (dải neo mảnh dưới header).
   - `IntersectionObserver` gắn `aria-current` cho mục đang xem.
   - Mọi `section[id]` của trang có `scroll-margin-top`.
4. **UX-07:** trang ga xếp lại nhịp nền: giấy (kể chuyện, đường đến) → bảng ga đen (lịch mùa) → giấy (một ngày, ảnh) → giấy vé (giá đã gồm, hạng phòng). Không còn quá hai dải dài cùng nền liền nhau.
5. **P6 — liên hệ lễ tân khi lỗi mạng** ở SCR-03 và SCR-04:
   - Cạnh nút "Thử lại" hiện dòng liên hệ lễ tân từ `NEXT_PUBLIC_FRONT_DESK_CONTACT`; chưa cấu hình thì hiện lời hướng dẫn chung.
   - Không `mailto:`, không giữ chỗ ngoài hệ thống (kế hoạch §8.3).
6. Đủ sáu ngôn ngữ.

## Tiêu chí nghiệm thu

1. Unit:
   - dòng so sánh lấy đúng sức chứa, số chỗ ngủ, cách bán của năm hạng;
   - câu liên hệ lễ tân chọn đúng bản có số / bản chung;
   - mục lục chỉ gồm mục có trên trang.
2. E2E `scr89`:
   - bảng so sánh có năm hàng, hàng đang xem có `aria-current`, đọc được ở 360 px;
   - rê vào ga trên sơ đồ thì thẻ ga sáng;
   - mặt cắt điều khiển bằng mũi tên, tóm tắt đổi, hàng hạng sáng;
   - mục lục trang ga có `aria-current` khi cuộn;
   - lỗi mạng ở SCR-03 và SCR-04 hiện dòng lễ tân, không có `mailto:`;
   - axe sạch.
3. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build.

## Ngoài phạm vi

- Phòng tắm riêng/chung theo hạng: chưa có nguồn trong `docs/02` hay seed.
- Mục lục bám cuộn trên trang chủ: trang chủ đã có thanh điều hướng và khối tìm phòng ở đầu; để sau khi đo.
