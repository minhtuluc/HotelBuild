---
id: HB-318
title: Trang /dining (P4) và khối "Giá đã gồm" (P5, UX-03) cho customer web, điều khoản tiện nghi trong giá ở docs/02
risk: R1
owner: claude
max_lines: 2500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr84-an-uong-va-gia-da-gom.spec.ts
  - DESIGN.md
  - docs/02-nghiep-vu/tien-nghi-trong-gia.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-318-am-thuc-va-gia-da-gom.md
unlock:
  - docs/02-nghiep-vu/tien-nghi-trong-gia.md
  - docs/08-thi-cong/tickets/HB-318-am-thuc-va-gia-da-gom.md
---

# HB-318 — Ăn uống ở ga và "Giá đã gồm"

> Đặc tả do frontend lead soạn theo quyết định của chủ dự án ngày 15/11/2026 cho hai việc chờ trong [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md):
> - **P4:** giữ trang `/dining`, tạm dựng nội dung minh hoạ.
> - **P5:** giá phòng đã gồm tiện nghi cơ bản, ghi thành điều khoản.
>
> Chồng trên HB-313 (#311) vì cần đủ sáu ngôn ngữ.

## Vấn đề

- Khách không biết ở ga có ăn sáng không, ăn tối ở đâu, giá phòng gồm những gì.
- Báo cáo góp ý (CONT-04, UX-03) đề xuất trang ẩm thực và khối "Vé gồm / Chưa gồm". Kế hoạch giữ lại vì chưa có điều khoản thương mại (Q12).

## Thay đổi

1. **Điều khoản** `docs/02-nghiep-vu/tien-nghi-trong-gia.md` (chủ dự án quyết P5):
   - ĐK-TN-01: tiện nghi đã gồm cho mọi hạng.
   - ĐK-TN-02: thêm cho Dorm.
   - ĐK-TN-03: không gồm.
   - Ràng buộc: không cộng phí cho tiện nghi cơ bản; khoản không gồm trả tại quầy, ngoài hệ thống đặt phòng.
   - Không thêm mã BR, không đổi công thức giá.
2. **Nội dung** `content/dining-page.ts`:
   - Khoá cố định theo điều khoản: ba nhịp (bữa sáng gọi riêng, góc trà đã gồm, bữa tối không phục vụ) và khung giờ.
   - Câu chữ theo locale: `vi` và `en` tại chỗ; zh-CN, ja, ko, ru trong gói nội dung (`dining`, `included`).
   - Giờ, món và quán quanh ga là minh hoạ (`illustrative: true`), trang có câu nói rõ điều đó.
3. **Trang `/dining`:**
   - Nhịp dải giấy → bảng ga (ba khung giờ, nhãn trạng thái) → giấy (quanh ba ga, lời dặn) → giấy vé (giá đã gồm, CTA tìm phòng).
   - Có link ở chân trang.
4. **Khối "Giá đã gồm"** (`components/content/price-includes.tsx`):
   - Hai cột đã gồm / chưa gồm.
   - Mục Dorm chỉ hiện ở trang Dorm, trang ga và trang ẩm thực.
   - Gắn vào trang hạng phòng, trang ga, trang ẩm thực.

## Tiêu chí nghiệm thu

1. Unit:
   - Mọi locale đủ ba nhịp, gợi ý cho từng ga và lời dặn.
   - Trạng thái ba nhịp khớp điều khoản.
   - Số mục đã gồm / Dorm / chưa gồm ở mọi locale bằng số dòng TN/KG trong `tien-nghi-trong-gia.md`.
2. E2E `scr84`:
   - `/dining` đúng giờ, trạng thái, ba ga, khối giá đã gồm; axe sạch.
   - Link chân trang giữ tiền tố ngôn ngữ.
   - Trang Deluxe không có mục Dorm; trang ga có khối.
   - 360px không cuộn ngang.
3. Toàn bộ E2E customer web, typecheck, lint, `check:docs` đạt trên bản build production; `impeccable detect` sạch trên trang mới.

## Ngoài phạm vi

- Thông tin ăn uống thật của từng cơ sở: thay nội dung minh hoạ trước ngày phát hành công khai.
- Bán dịch vụ ăn uống qua hệ thống: điều khoản ghi rõ là ngoài hệ thống.
- P6 (nút giữ chỗ qua email): vẫn chờ chủ dự án.
