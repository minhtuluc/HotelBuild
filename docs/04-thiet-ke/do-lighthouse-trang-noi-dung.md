# Đo Lighthouse mobile — trang nội dung customer web

> HB-325, đo ngày 16/11/2026. Tiêu chí nghiệm thu đợt 3 của [kế hoạch phát triển giao diện](ke-hoach-phat-trien-giao-dien-tiep-theo.md): "LCP ảnh đầu trang dưới 2,5 s trên cấu hình Lighthouse mobile".

## Kết luận

- **Đạt** khi đo bằng giới hạn mạng và CPU thật (`throttlingMethod: devtools`): trung vị LCP mọi trang nội dung dưới 2,5 s. Trang có ảnh đầu trang (ba trang ga) ở 2,28–2,41 s.
- **Chưa đạt** với cách ước tính mặc định của Lighthouse (`simulate`) ở ba trang ga: 3,61–3,94 s. 11 trang còn lại đạt (1,06 s).
- **Mức sàn khoảng 3,3–3,9 s của `simulate` không nằm ở ảnh:** Phan Thiết với ảnh áp phích chỉ 37 KB vẫn 3,3–3,8 s. Phần còn lại là tài liệu HTML, CSS, JS lõi của React/Next (khoảng 100 KB gzip) và font của màn đầu, đều tải trước lần vẽ đầu. `simulate` dựng mô hình mạng 4G chậm (1,6 Mbps, RTT 150 ms) và tính mọi yêu cầu bắt đầu trước lần vẽ đó. Hạ tiếp chỉ còn hướng đổi cách nạp script của Next; chủ dự án đã quyết **giữ nguyên bộ font** (16/11/2026), không bỏ độ đậm 500. Ghi ở TD-83.

## Cách đo

- **Bản đo:** `next build` + `next start` của customer web, API giả `tests/e2e/fake-api`, máy chủ chạy tại máy.
- **Lighthouse:** bản 13.6.0, cấu hình mobile mặc định (Moto G Power giả lập: 412×823, DPR 1,75; mạng 4G chậm; CPU ×4); chỉ nhóm Performance.
- **Số lần đo:** mỗi trang 3 lần, lấy trung vị LCP. Trước mỗi đợt đo có gọi thử từng trang một lần để máy chủ nóng.
- **Máy đo:**
  - Windows 11, Chromium 156 (bản của Playwright); `benchmarkIndex` khoảng 2.200.
  - Lúc đo không có việc nặng nào khác chạy. Một đợt đo trước đó bị bỏ vì máy đang render Blender.
  - Ứng dụng nền (IDE, app Claude) vẫn mở.
- **"Trước":** commit `cc2c439` (nhánh HB-325 tại commit đặc tả, mã giống hệt HB-324). **"Sau":** mã nộp ở HB-325.
- **Script:** `apps/customer-web/scripts/lighthouse-mobile.mjs` (đầu file ghi cách cài Lighthouse tạm và các biến môi trường).

## Kết quả

### `simulate` (mặc định của Lighthouse), 14 trang

| Trang | Phần tử LCP | LCP trước | LCP sau | CLS trước → sau | TBT trước → sau | Điểm trước → sau |
|---|---|---|---|---|---|---|
| `/` | tiêu đề vé tìm phòng (chữ) | 1,19 s | 1,06 s | 0,000 → 0,027 | 307 → 286 ms | 93 → 94 |
| `/stays/da-lat` | ảnh áp phích ga | 4,81 s | 3,94 s | 0,007 → 0,001 | 336 → 189 ms | 75 → 85 |
| `/stays/phan-thiet` | ảnh áp phích ga | 4,21 s | 3,79 s | 0,008 → 0,001 | 297 → 183 ms | 80 → 86 |
| `/stays/vung-tau` | ảnh áp phích ga | 5,41 s | 3,61 s | 0,008 → 0,001 | 251 → 194 ms | 75 → 87 |
| `/room-types/STD` | thông số mặt sau vé (chữ) | 1,06 s | 1,06 s | 0,015 → 0,001 | 365 → 82 ms | 91 → 100 |
| `/room-types/SUP` | như trên | 1,06 s | 1,06 s | 0,039 → 0,001 | 430 → 94 ms | 89 → 99 |
| `/room-types/DLX` | như trên | 1,06 s | 1,06 s | 0,015 → 0,001 | 320 → 118 ms | 93 → 99 |
| `/room-types/FAM` | như trên | 1,06 s | 1,06 s | 0,041 → 0,019 | 528 → 105 ms | 86 → 99 |
| `/room-types/DOR` | như trên | 1,06 s | 1,06 s | 0,049 → 0,001 | 293 → 112 ms | 93 → 99 |
| `/dining` | câu dẫn (chữ) | 1,06 s | 1,06 s | 0,006 → 0,000 | 310 → 105 ms | 93 → 99 |
| `/getting-here` | câu dẫn | 1,06 s | 1,06 s | 0,006 → 0,001 | 253 → 99 ms | 95 → 99 |
| `/experiences` | câu dẫn | 1,06 s | 1,06 s | 0,041 → 0,020 | 315 → 108 ms | 93 → 99 |
| `/offers` | câu dẫn | 1,06 s | 1,06 s | 0,048 → 0,036 | 308 → 106 ms | 93 → 99 |
| `/gallery` | câu dẫn | 1,06 s | 1,06 s | 0,152 → 0,000 | 199 → 48 ms | 91 → 100 |

### `devtools` (giới hạn mạng và CPU thật), ba trang ga

| Trang | LCP trước | LCP sau | Ba lần đo (sau) |
|---|---|---|---|
| `/stays/da-lat` | 5,65 s | **2,28 s** | 2,26 / 2,32 / 2,28 |
| `/stays/phan-thiet` | 3,58 s | **2,28 s** | 2,28 / 2,32 / 2,26 |
| `/stays/vung-tau` | 5,63 s | **2,41 s** | 2,41 / 2,40 / 2,42 |

## Nguyên nhân tìm ra và đã sửa

1. **Ảnh áp phích quá nặng cho điện thoại:** file gốc 1200×1600, 120–330 KB, trong khi chỉ hiện khoảng 362 CSS px. Đã sinh bản 640w/960w (`scripts/photo-variants.mjs`, `variants.json`) và dùng `srcset` + `sizes`. Điện thoại tải bản 640w (37–99 KB).
2. **Mọi trang tải toàn bộ schema zod (khoảng 95 KB gzip):** `i18n/client` import từ barrel `@pinehill/ui-web`, mà barrel có `errors.ts` → `@pinehill/contracts`. Đã bật `optimizePackageImports`; First Load JS của trang ga giảm từ 241 KB xuống 125 KB, trang hạng còn 123 KB.
3. **Header (HB-324) import client phiên:** đã đổi sang chỉ đọc cookie gợi ý (`@pinehill/web-session/hint`), client phiên chỉ nạp khi bấm "Đăng xuất".
4. **Bảng giờ trang ga gọi API trước lần vẽ đầu:** đã hoãn tới sau sự kiện `load`, nạp động.
5. **Gallery cuối trang ga tải trước LCP,** cỡ 960w, và tải lại chính ảnh áp phích ở cỡ khác. Đã chỉnh `sizes` ở màn hẹp còn 50vw (trùng file áp phích) và đặt `content-visibility: auto` cho lưới ảnh.
6. **Sáu phân đoạn font `latin-ext` bị tải thừa:** chúng khai báo sau bộ `vietnamese` nên trình duyệt chọn chúng cho Đ, Ă, Ơ. Đã bỏ; tiếng Việt đủ ký tự trong `latin` + `vietnamese`.
7. **Chữ đổi font sau lần vẽ đầu làm xô lệch bố cục (CLS 0,08–0,15)** khi trang vẽ sớm hơn. Đã preload 4 file font màn đầu (Barlow Condensed 600, Be Vietnam Pro 600; latin + vietnamese).

**Đã thử rồi bỏ:** `content-visibility` cho cả dải nội dung. Phần chưa dựng hình không đo được màu nền, nên axe báo sai tương phản. Giữ cho lưới ảnh (không có chữ hiển thị).

## Đo lại

Chạy trên máy rảnh, sau `next build`:

```bash
node apps/customer-web/scripts/photo-variants.mjs   # khi thêm hay thay ảnh
```

```bash
RUNS=3 PAGES="ROOT,stays/da-lat,stays/phan-thiet,stays/vung-tau" node lighthouse-mobile.mjs
```

```bash
THROTTLE=devtools RUNS=3 PAGES="stays/da-lat,stays/phan-thiet,stays/vung-tau" node lighthouse-mobile.mjs
```

Số đo tại máy chỉ để so trước/sau. Trước ngày ra mắt nên đo lại trên môi trường staging (PageSpeed Insights hoặc Lighthouse CI) để có số khớp mạng thật.
