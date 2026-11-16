---
id: HB-322
title: Trang ga và trang hạng sâu hơn — bảng chặng đến ga (UX-05), "Một ngày tại ga" và lịch mùa điền sẵn ngày (CONT-02, FEAT-02), bố cục khoang và "Nói thẳng" (CONT-01)
risk: R1
owner: claude
max_lines: 2500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr87-trang-ga-va-hang-sau-hon.spec.ts
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-322-trang-ga-va-hang-sau-hon.md
unlock:
  - docs/08-thi-cong/tickets/HB-322-trang-ga-va-hang-sau-hon.md
---

# HB-322 — Trang ga và trang hạng sâu hơn

> Đặc tả do frontend lead soạn theo §8 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (CONT-01, CONT-02, UX-05, FEAT-02 của báo cáo góp ý). Chồng trên HB-317 (#322) vì lịch mùa dùng phần điền sẵn ngày từ URL.

## Vấn đề

- Trang ga mới có tóm tắt, hai đoạn kể chuyện và ba gạch đầu dòng đường đến. Khách không biết đến mất bao lâu, ở đó một ngày trôi thế nào, tháng nào nên đi.
- Trang hạng chưa tả khoang trông ra sao, cũng chưa nói thẳng những điều khách hay hỏi (giá đổi theo đêm, Dorm là phòng chung).

## Thay đổi

1. **UX-05 — bảng chặng đến ga.** `arrival: string[]` đổi thành `legs: { time; route }[]` và `arrivalNote`. Cột trái in thời gian ước lượng (`tabular-nums`), cột phải tả chặng. Thời gian là ước lượng, gắn `illustrative`; không ghi mã chuyến hay giờ chạy (§8.2, CONT-03).
2. **CONT-02 — "Một ngày tại ga":** ba buổi (sáng sớm, giữa ngày, chiều tối), mỗi buổi một đoạn tả. Không có giờ phục vụ, tiện ích hay dịch vụ (§8.2).
3. **FEAT-02 — lịch mùa tại ga** (`SeasonAlmanac`):
   - 4 mùa mỗi ga, tháng của mùa nằm ở khoá không đổi theo ngôn ngữ (`seasonMonths`), phủ đủ 12 tháng, không trùng.
   - Mỗi mùa: tên, thời tiết (nhiệt độ, mưa — minh hoạ), gợi ý. Không nhãn mùa giá (Q14).
   - Đánh dấu mùa hiện tại (giờ VN) và nút "Chọn cuối tuần gần nhất" → `/?ga=<slug>&checkIn=<thứ Sáu>&checkOut=<Chủ nhật>#search-block`. Ngày tính ở trình duyệt sau khi tải (trang dựng tĩnh); trước đó nút về khối tìm phòng với ga chọn sẵn.
4. **CONT-01 — trang hạng:**
   - Khối "Trong khoang": một đoạn tả bố cục theo số chỗ ngủ (seed `bedCount`), gắn `illustrative`. Không diện tích, view, tiện nghi.
   - Khối "Nói thẳng": chỉ điều có nguồn (§8.2 UX-03) — giá đổi theo đêm; tiền hoàn tính trên số đã trả; mỗi ga bán phòng riêng (giá, phòng trống, giờ nhận phòng của ga đó); Dorm bán theo giường trong phòng chung.
5. Đủ sáu ngôn ngữ; câu chữ mới của zh-CN, ja, ko, ru cần người bản ngữ duyệt (Q6).

## Tiêu chí nghiệm thu

1. Unit:
   - mọi ga, mọi locale có đủ chặng, ba buổi, 4 mùa; tháng các mùa phủ đủ 12 tháng, không trùng;
   - mọi hạng, mọi locale có đoạn bố cục; không câu chữ nào có số tiền hay diện tích;
   - cuối tuần gần nhất trong mùa: đúng thứ Sáu → Chủ nhật, không trước hôm nay, qua năm mới đúng; mùa hiện tại theo tháng.
2. E2E `scr87`: trang ga có bảng chặng, ba buổi, 4 mùa, đúng một mùa hiện tại; bấm nút cuối tuần thì khối tìm phòng có ga và ngày điền sẵn; trang hạng có "Trong khoang" và "Nói thẳng" (Dorm có dòng phòng chung); axe sạch; không cuộn ngang ở 360 px.
3. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build; JS tĩnh không chứa câu chữ các ngôn ngữ khác.

## Ngoài phạm vi

- Ảnh nhiều góc của từng hạng (CONT-01): chưa có ảnh thật; thêm ô ảnh khi có file.
- Tiện ích dùng chung tại ga (`stationServices`): không có trong nghiệp vụ (§8.2).
- Sơ đồ mặt cắt 5 khoang (UX-02), trang `/getting-here`, `/experiences` (HB-311b).
