---
id: HB-317
title: Góp ý UI/UX gói C — giữ ngữ cảnh ga/ngày/khách trên URL (FEAT-01), chọn nhanh số đêm (FEAT-03), sao chép link báo giá và bản in A4 (FEAT-06)
risk: R1
owner: claude
max_lines: 1500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr86-giu-ngu-canh-va-tien-ich.spec.ts
  - tests/e2e/scr02-03-ket-qua-chi-tiet.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-317-giu-ngu-canh-va-tien-ich.md
unlock:
  - docs/08-thi-cong/tickets/HB-317-giu-ngu-canh-va-tien-ich.md
---

# HB-317 — Giữ ngữ cảnh hành trình và tiện ích đặt vé

> Đặc tả do frontend lead soạn theo §8 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (gói C của báo cáo góp ý: FEAT-01, FEAT-03, FEAT-06). Chồng trên HB-311 (#321) vì cùng sửa khối tìm phòng.

## Vấn đề

- Khách đã chọn ngày và số khách, sang trang hạng xem rồi quay lại thì phải nhập lại từ đầu.
- Trên điện thoại, chọn hai ô ngày tốn 4–6 chạm chỉ để xem thử giá.
- Không có cách gửi báo giá cho người đi cùng hay in thành phiếu.

## Thay đổi

1. **FEAT-01 — ngữ cảnh trên URL** (không dùng `sessionStorage`, kế hoạch §8). Mọi giá trị được kiểm lại; giá trị sai bị bỏ.
   - Khối tìm phòng điền sẵn `checkIn`, `checkOut`, `adults`, `children`, `propertyId` từ URL. `propertyId` ngoài danh sách máy chủ trả bị bỏ qua.
   - SCR-02: mỗi dòng có link phụ "Xem hạng …" sang `/room-types/<code>` giữ nguyên kỳ.
   - Trang hạng: có kỳ hợp lệ trên URL thì nút chính (đầu trang và cuống vé) thành "Xem phòng trống cho kỳ này", dẫn thẳng về SCR-02 cùng kỳ, kèm dòng tóm tắt kỳ.
   - Trang ga: có ngày thì nút chính về khối tìm phòng với ga của trang và ngày, khách điền sẵn. `propertyId` trên URL bị bỏ vì có thể là ga khác.
2. **FEAT-03 — chọn nhanh 2 / 3 / 5 đêm** trên vé tìm phòng.
   - Nhãn trung tính, không hứa giảm giá.
   - Giữ ngày nhận đang chọn; trống, sai hoặc đã qua thì lấy hôm nay (giờ VN).
3. **FEAT-06 — báo giá SCR-03:**
   - Nút "Sao chép link báo giá": link mang tiêu chí và gói giá đang xem, không mang số tiền; người nhận mở link thì máy chủ báo giá lại.
   - SCR-03 đọc `ratePlanCode` trên URL, chỉ nhận gói có trong danh sách máy chủ trả.
   - Nút "In / lưu báo giá" và bản in A4 (`@media print`) chung cho SCR-03 và kết quả đặt phòng: ẩn điều hướng, nút, cuống vé; giữ bảng giá từng đêm, tóm tắt, mã đặt phòng.

## Tiêu chí nghiệm thu

1. Unit `test/scr01-tim-phong/journey-context.spec.ts`:
   - đọc URL (bỏ giá trị sai), ghép bản nháp, chọn nhanh số đêm, cơ sở gợi ý theo id;
   - đích nút trang hạng và trang ga;
   - link chia sẻ.
2. E2E `scr86`:
   - điền sẵn từ URL; chọn nhanh 3 đêm (axe sạch);
   - kết quả → trang hạng → về lại kết quả cùng kỳ; nút trang ga;
   - sao chép link và mở link chọn đúng gói; bản in ẩn điều hướng, giữ bảng giá.
3. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build; JS tĩnh vẫn không chứa câu chữ các ngôn ngữ khác.

## Ngoài phạm vi

- FEAT-02 (lịch mùa điền sẵn ngày): cần lịch mùa của trang ga sâu hơn (HB-322).
- Nút giữ chỗ qua email khi lỗi mạng: chờ chủ dự án quyết P6.
- FEAT-04 (mốc huỷ quy ra ngày giờ): chờ API trả mốc tuyệt đối (yêu cầu API §7).
- FEAT-05 (ma trận so sánh hạng): chưa xếp lịch.
