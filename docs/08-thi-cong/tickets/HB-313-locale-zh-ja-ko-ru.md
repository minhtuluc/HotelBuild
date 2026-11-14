---
id: HB-313
title: Đợt 6 frontend — locale zh-CN, ja, ko, ru cho customer web, quy tắc font CJK, chỉ gửi danh mục của locale đang xem xuống trình duyệt
risk: R1
owner: claude
max_lines: 6000
allow:
  - apps/customer-web/src/**
  - apps/customer-web/test/**
  - tests/e2e/scr82-tieng-anh.spec.ts
  - tests/e2e/scr83-tieng-trung-nhat-han-nga.spec.ts
  - DESIGN.md
  - docs/04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md
  - docs/08-thi-cong/tickets/HB-313-locale-zh-ja-ko-ru.md
unlock:
  - docs/08-thi-cong/tickets/HB-313-locale-zh-ja-ko-ru.md
---

# HB-313 — Đợt 6 frontend: tiếng Trung giản thể, Nhật, Hàn, Nga

> Đặc tả do frontend lead soạn theo đợt 6 [kế hoạch phát triển giao diện](../../04-thiet-ke/ke-hoach-phat-trien-giao-dien-tiep-theo.md) (quyết định Q2, Q6) và [kế hoạch đa ngôn ngữ](../../04-thiet-ke/ke-hoach-da-ngon-ngu-customer-web.md). Chồng trên HB-312 (#308).

## Vấn đề

Customer web có `vi` và `en`. Khách Trung Quốc, Nhật, Hàn, Nga là nhóm khách lớn của ba ga nhưng chưa đọc được trang. Font thương hiệu chỉ có bộ Latin + tiếng Việt, nên chữ Hán, Kana, Hangul và Cyrillic rơi về font mặc định của trình duyệt, không có quy tắc.

## Thay đổi

1. **Registry:** thêm `zh-CN` (`/zh-cn`), `ja` (`/ja`), `ko` (`/ko`), `ru` (`/ru`) vào `LOCALES` / `LOCALE_META`. Middleware, `hreflang`, nút chọn ngôn ngữ tự nhận.
2. **Danh mục:** `catalogs/{zh-cn,ja,ko,ru}/` đủ khoá như `vi` (kiểu `Record` báo thiếu).
   - Tiếng Nga chưa có số nhiều ngữ pháp: câu có số đặt số sau dấu hai chấm ("Ночей: 3").
   - Danh sách khoá chính sách cần duyệt (`EN_NEEDS_REVIEW`) áp cho mọi locale ngoài `vi`.
3. **Nội dung tĩnh:** mỗi locale một gói `content/locale-packs/<locale>.ts` (trang chủ, trang ga, trang hạng, alt ảnh) để người duyệt đọc một chỗ. Mã gói, số tiền, mốc giờ giữ nguyên.
4. **Định dạng:** ngày lịch và mốc giờ VN theo thói quen từng ngôn ngữ (`2026/12/24(木)`, `2026. 12. 24.`, `24.12.2026`); `vi`, `en` không đổi.
5. **Font (`app/locale-type.css`, DESIGN.md › Typography):**
   - Đặt lại `--font-sans` / `--font-display` theo `:lang()`: font thương hiệu giữ cho chữ Latin và số; chữ Hán, Kana, Hangul rơi về font hệ thống đúng chữ (PingFang SC / Microsoft YaHei, Hiragino / Yu Gothic, Apple SD Gothic Neo / Malgun Gothic, rồi Noto).
   - CJK: bỏ giãn chữ, mở dòng tiêu đề, ngắt dòng `strict` (zh, ja), `keep-all` (ko). Không tải font CJK.
6. **Bundle trình duyệt:** `LocaleProvider` nhận danh mục của locale đang xem từ layout (máy chủ). Client chỉ mang sẵn bản `vi` (mặc định khi render ngoài provider), không mang cả sáu ngôn ngữ.

## Tiêu chí nghiệm thu

1. Unit: mọi locale đủ khoá, placeholder `{…}` khớp `vi`; gói nội dung có đủ alt mọi ô ảnh; dữ kiện chính sách và ví dụ giá trùng bản `vi`; ngày, giờ, tiền theo ngôn ngữ.
2. E2E `scr83`: mỗi locale đúng `html lang`, tiêu đề, link giữ tiền tố, font CJK trong `font-family`, trang ga đúng ngôn ngữ, 360px không cuộn ngang, axe sạch; chọn ngôn ngữ đủ sáu mục; tìm phòng bằng tiếng Nhật.
3. Toàn bộ E2E customer web, typecheck, lint đạt trên bản build production.
4. Chuỗi bốn ngôn ngữ không có trong JS tĩnh của trình duyệt.

## Ngoài phạm vi

- Duyệt bản dịch bởi người bản ngữ (bắt buộc trước ngày phát hành công khai).
- Số nhiều theo ngữ pháp (ICU plural) cho tiếng Nga.
- Thông báo lỗi nghiệp vụ, tên gói giá do API trả vẫn là tiếng Việt (chờ `Accept-Language`).
