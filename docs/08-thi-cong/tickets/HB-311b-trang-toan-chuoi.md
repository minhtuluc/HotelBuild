---
id: HB-311b
title: Bốn trang toàn chuỗi (đường đến, trải nghiệm, ưu đãi, thư viện ảnh) và menu "Khám phá" cho customer web (CONT-03, 05, 06, 07, 08; lưới ảnh dense UX-07)
risk: R1
owner: claude
max_lines: 3500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr88-trang-toan-chuoi.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-311b-trang-toan-chuoi.md
unlock:
  - docs/08-thi-cong/tickets/HB-311b-trang-toan-chuoi.md
---

# HB-311b — Trang toàn chuỗi và menu "Khám phá"

> Đặc tả do frontend lead soạn theo §5, §8 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (CONT-03, CONT-05, CONT-06, CONT-07, CONT-08 của báo cáo góp ý; lưới ảnh nhiều tỉ lệ của UX-07). Chồng trên HB-322 (#323): trang đường đến dùng bảng chặng của từng ga.

## Vấn đề

- Ngoài trang chủ, ba trang ga, năm trang hạng và `/dining`, khách không có chỗ đọc đường đến cả tuyến, việc nên làm quanh ga, cách giá giảm theo số đêm, hay xem hết ảnh.
- Header chỉ có bốn link giao dịch; trang nội dung chỉ tìm được qua trang chủ hoặc chân trang.

## Thay đổi

1. **`/getting-here` (CONT-03):**
   - Bảng chặng của cả ba ga (dùng lại `legs` của HB-322), mỗi ga link sang trang ga.
   - Sơ đồ tuyến (`RouteMap`) và khối khách quốc tế: bay vào Tân Sơn Nhất rồi nối chặng; e-Visa chỉ đặt link tới cổng chính thức của Việt Nam.
   - Thời gian là ước lượng; không mã chuyến, không giờ chạy (§8.2).
2. **`/experiences` (CONT-05):**
   - Ba hoạt động quanh mỗi ga, gắn "Quanh năm" hoặc tháng của mùa (khoá không đổi theo ngôn ngữ).
   - Không lịch sự kiện có ngày cụ thể (§8.2). Mỗi ga có link sang trang ga và khối tìm phòng.
3. **`/offers` (CONT-06), chỉ quy tắc có trong `docs/02`:**
   - Hệ số theo số đêm (§4.4): 3–6 đêm × 0,95, 7–13 đêm × 0,90, từ 14 đêm × 0,85; áp cho gói có bật giảm theo số đêm.
   - Bảng 4 gói: cọc, số đêm tối thiểu, có giảm theo số đêm hay không, đổi ngày, bậc hoàn (dùng lại `farePlans` của trang chủ).
   - Điều khoản: hoàn tính trên số đã trả; giá cuối cùng là báo giá; hoàn xử lý trong 3 ngày làm việc, tối đa 7 ngày.
   - Không so sánh với kênh trung gian (Q15), không mã khuyến mãi, không số tiền.
4. **`/gallery` (CONT-07, UX-07):**
   - Mọi ô ảnh có file, lọc theo ga và theo nhóm (áp phích, phòng, cảnh).
   - Lưới nhiều tỉ lệ (`dense`) khi từ 6 ảnh: áp phích dọc, cảnh ngang.
   - Lightbox có link sang trang ga hoặc trang hạng của ảnh.
5. **Menu "Khám phá" (CONT-08):**
   - Nút trên header mở bảng link: ba ga, hạng phòng, ăn uống, trải nghiệm, ưu đãi, đường đến, thư viện ảnh.
   - `aria-expanded`, `aria-controls`, đóng bằng Esc hoặc bấm ra ngoài, trả tiêu điểm về nút.
   - Dưới 760 px là ngăn kéo toàn chiều ngang.
   - Chân trang có đủ trang nội dung.
6. Đủ sáu ngôn ngữ; câu chữ mới của zh-CN, ja, ko, ru cần người bản ngữ duyệt (Q6).

## Tiêu chí nghiệm thu

1. Unit:
   - mọi trang, mọi locale đủ câu chữ;
   - hoạt động có ga và tháng hợp lệ;
   - hệ số số đêm và thông số 4 gói khớp bảng §4.4 của `docs/02` (đọc tài liệu);
   - nhóm và ga của ô ảnh, link của ảnh đúng trang;
   - không số tiền trong câu chữ.
2. E2E `scr88`:
   - bốn trang mở được, có h1, axe sạch, không cuộn ngang ở 360 px;
   - lọc thư viện ảnh theo ga, lightbox có link sang trang ga;
   - menu Khám phá mở/đóng bằng bàn phím, Esc trả tiêu điểm;
   - trang tiếng Anh có đủ.
3. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build; JS tĩnh không chứa câu chữ các ngôn ngữ khác.

## Ngoài phạm vi

- Ảnh mới, chuẩn hoá alt 12–22 từ: chờ ảnh thật.
- Dịch vụ đưa đón, liên hệ trước chuyến đi: liên hệ lễ tân làm ở HB-323 (P6).
- Mục lục bám cuộn (UX-06), xen kẽ band (UX-07 phần nhịp nền), so sánh hạng (FEAT-05), sơ đồ hai chiều (UX-02): HB-323.
