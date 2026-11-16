---
id: HB-326
title: Ảnh minh hoạ cho các chỗ còn chờ ảnh — ảnh nhiều góc của năm hạng (CONT-01), chín hoạt động ở /experiences, ba dịch vụ ở /dining
risk: R1
owner: claude
max_lines: 1500
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - apps/customer-web/public/images/pine-hill/**
  - tests/e2e/scr88-trang-toan-chuoi.spec.ts
  - tests/e2e/scr91-anh-minh-hoa.spec.ts
  - docs/04-thiet-ke/anh-trang-khach.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-326-anh-minh-hoa-cho-o-con-trong.md
unlock:
  - docs/08-thi-cong/tickets/HB-326-anh-minh-hoa-cho-o-con-trong.md
---

# HB-326 — Ảnh minh hoạ cho các chỗ còn chờ ảnh

> Đặc tả do frontend lead soạn. Chủ dự án giao ngày 16/11/2026: tìm ảnh minh hoạ trên mạng cho mọi chỗ còn chờ ảnh. Bản demo cho khách, chưa triển khai công khai. Chồng trên HB-325 (#327).

## Vấn đề

Ba nhóm nội dung đã lên kế hoạch nhưng tạm hoãn vì chưa có ảnh:
- **Trang hạng:** mỗi hạng chỉ có một ảnh; ảnh nhiều góc (CONT-01) hoãn ở HB-322.
- **`/experiences`:** chín hoạt động quanh ga chỉ có chữ.
- **`/dining`:** ba dịch vụ (bữa sáng, góc trà, bữa tối quanh ga) chỉ có chữ.

## Thay đổi

1. **22 ảnh minh hoạ, cắt 4:3 (1200×900), WebP, có bản 640w/960w:**
   - Nguồn có giấy phép dùng lại: Wikimedia Commons (cảnh Đà Lạt, Mũi Né, Vũng Tàu, món ăn) và Pexels (nội thất).
   - Ghi nguồn, tác giả, giấy phép từng ảnh trong `docs/04-thiet-ke/anh-trang-khach.md`.
   - Không chọn ảnh có mặt người nhìn rõ; không chọn ảnh ngụ ý tiện nghi chưa có nguồn.
2. **Ô ảnh mới trong `photo-slots.ts`, alt đủ sáu ngôn ngữ:**
   - `hang-<MÃ>-2`, `hang-<MÃ>-3` (10 ô);
   - `tn-<mã hoạt động>` (9 ô);
   - `an-breakfast`, `an-tea`, `an-evening` (3 ô).
3. **Hiển thị:**
   - Trang hạng: gallery có thêm hai ảnh.
   - `/experiences`: mỗi thẻ hoạt động có ảnh.
   - `/dining`: mỗi dịch vụ có ảnh.
   - `/gallery`: ảnh hạng mới vào nhóm "Hạng phòng"; ảnh hoạt động vào nhóm "Cảnh quanh ga" theo ga.
   - Ảnh `lazy`, có `srcset`; ô chưa có file vẫn tự ẩn như cũ.

## Tiêu chí nghiệm thu

1. Unit:
   - mọi ô mới có alt sáu ngôn ngữ (`locale-packs.spec`);
   - mọi ô có file và có bản nhỏ (`photo-variants.spec`);
   - mã ô hoạt động khớp `EXPERIENCES`;
   - gallery xếp đúng nhóm và ga.
2. E2E:
   - trang hạng có 3 ảnh;
   - `/experiences` có 9 ảnh, `/dining` có 3 ảnh, đều tải được;
   - lọc `/gallery` theo ga và nhóm ra đúng số ảnh;
   - axe sạch, 360 px không cuộn ngang.
3. Toàn bộ E2E customer web đạt trên bản build.

## Ngoài phạm vi

- Thay các ảnh Amanoi đang dùng (không có giấy phép dùng lại): giữ cho demo, đã nằm trong danh sách rà trước ngày ra mắt.
- Ảnh thật của Pine Hill: chờ chủ dự án.
