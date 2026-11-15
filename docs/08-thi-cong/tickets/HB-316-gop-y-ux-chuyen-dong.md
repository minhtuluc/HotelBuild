---
id: HB-316
title: Góp ý UI/UX gói B — bảng giá từng đêm trên điện thoại, cỡ chữ theo khung, lightbox chạm, bộ chuyển động cơ khí có công tắc giảm chuyển động
risk: R1
owner: claude
max_lines: 1500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr80-trang-noi-dung.spec.ts
  - tests/e2e/scr81-chuyen-dong-va-bang-mobile.spec.ts
  - DESIGN.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-316-gop-y-ux-chuyen-dong.md
unlock:
  - docs/08-thi-cong/tickets/HB-316-gop-y-ux-chuyen-dong.md
---

# HB-316 — Góp ý UI/UX gói B: bảng mobile, cỡ chữ theo khung, lightbox chạm, chuyển động

> Đặc tả do frontend lead soạn theo §8 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (đánh giá [báo cáo góp ý UI/UX](../../04-thiet-ke/bao-cao-gop-y-cai-tien-ui-ux-va-noi-dung-customer-web.md)), các mã UX-01, UX-04, UX-08, ANIM-01…06. Chồng trên HB-310 (#305).

## Vấn đề

- Dưới 760 px, vé mẫu ở trang chủ ẩn hẳn cột "vì sao giá đêm này khác" (`.ph-sample-why`). Phần giải thích quan trọng nhất của trang bị mất trên điện thoại.
- Bảng giá từng đêm ở SCR-03 (`NightsTable`) giữ 4 cột trên 360 px, chật và phải đọc ngang.
- Tiêu đề trang nội dung co theo `vw`. Trong lưới hai cột 900–1150 px, cỡ chữ không theo đúng bề rộng cột chứa nó.
- Lightbox chưa vuốt được trên điện thoại và chưa đóng khi bấm ra nền.
- Ngoài chữ lật của bảng ga, giao diện hầu như không có phản hồi chuyển động. Đang tải SCR-02/03 chỉ là một dòng chữ, xong thì bảng hiện ra làm nhảy trang.

## Thay đổi

1. **UX-01:**
   - Vé mẫu dưới 640 px: mỗi đêm một thẻ (chặng + giá trên một hàng, ngày, rồi lý do chiếm trọn hàng dưới). Không ẩn lý do nữa.
   - `NightsTable` dưới 640 px: mỗi đêm một thẻ; ngày làm đầu thẻ, các cột còn lại thành dòng "nhãn: giá trị" (`td[data-label]`).
2. **UX-04:** `.ph-content-head-copy` là container (`container-type: inline-size`); tiêu đề trang nội dung dùng `cqi`.
3. **UX-08:** lightbox đóng khi bấm ra nền (ngoài khung ảnh), vuốt ngang trên khung ảnh để đổi ảnh (pointer events, ngưỡng 48 px).
4. **Bộ chuyển động** (`src/app/motion.css`, token `--ph-ease-*`, `--ph-dur-*`):
   - **ANIM-01:** giờ nhận/trả ở bảng giờ ga lật một lần khi có dữ liệu từ API. Hàng ga vừa chọn trên bảng ga lật nhẹ.
   - **ANIM-02:** tem mã hạng ở trang hạng đóng dấu một lần khi tải.
   - **ANIM-03:** mũi tên của các link "Đọc thêm / Xem hạng / Giá xem theo ngày" dịch 4 px khi hover/focus. Mũi tên là `aria-hidden`, không còn nằm trong tên đọc của link.
   - **ANIM-04:**
     - Các dải nội dung **dưới màn đầu** trượt nhẹ lên một lần khi cuộn tới.
     - Chỉ gắn trạng thái chờ bằng JS cho phần tử đang ở dưới màn hình, nên không có `opacity: 0` trước khi JS chạy.
     - Không chạm vùng LCP.
     - Ảnh gallery phóng 3,5% khi hover, nằm trong khung cố định.
   - **ANIM-05:** khung chờ đúng hình bảng ở SCR-02 (bảng phòng trống) và SCR-03 (bảng giá từng đêm) khi đang tải; `aria-hidden`, dòng "Đang tải…" của `StateSurface` vẫn giữ cho trình đọc màn hình.
   - **ANIM-06:** mọi hiệu ứng mới tắt khi `prefers-reduced-motion: reduce`; trượt khi cuộn không kích hoạt luôn.
5. **DESIGN.md:** mục Motion: token, sáu hiệu ứng và hai luật (không ẩn nội dung trước JS, không animate vùng LCP).

## Tiêu chí nghiệm thu

1. E2E `tests/e2e/scr81-chuyen-dong-va-bang-mobile.spec.ts`:
   - 360 px: vé mẫu hiện lý do của cả 3 đêm, không cuộn ngang. Bảng giá từng đêm thành thẻ có nhãn, không cuộn ngang.
   - Lightbox: bấm ra nền thì đóng; vuốt trái sang ảnh sau.
   - `prefers-reduced-motion: reduce`: phần tử có `data-reveal` không bao giờ mang trạng thái chờ.
   - Không phần tử nào có `opacity: 0` ở lần vẽ đầu (HTML máy chủ).
2. E2E hiện có của customer-web đạt (cập nhật tên link bỏ mũi tên ở `scr80`); axe không có lỗi serious/critical.
3. Typecheck, lint đạt; `impeccable detect` không có lỗi trên `/`, `/stays/da-lat`, `/room-types/DLX`.

## Ngoài phạm vi

- UX-02 (sơ đồ hai chiều, mặt cắt khoang), UX-06 (mục lục bám cuộn), UX-07 (gallery nhiều tỉ lệ): làm cùng HB-311/HB-311b.
- Dấu trạng thái ở SCR-03/05/06 (phần sau của ANIM-02, UX-04): cần thiết kế dấu theo trạng thái máy chủ, để HB-317.
