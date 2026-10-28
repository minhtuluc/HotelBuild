# Bằng chứng rà accessibility 83 màn hình (HB-185)

> Ticket: `docs/08-thi-cong/tickets/HB-185-ra-soat-truy-cap.md` · nhánh `ticket/HB-185-a11y`
> (base `origin/main` = `9ee00d9`) · NFR-USE-03/04/05, TC-SYS-10.
> Nguồn chuẩn danh mục: [`04-thiet-ke/thiet-ke-man-hinh.md` §3](../04-thiet-ke/thiet-ke-man-hinh.md)
> — đọc dòng 181–283 (web khách 13 · operations web 44 · customer Android 13 · operations Android 13).

## 1. Kết luận

| Chỉ số | Giá trị |
|---|---|
| Tổng màn theo thiết kế | **83** |
| Quét axe (Chromium, WCAG 2.1 A/AA) | **46** |
| PASS (0 vi phạm serious/critical) | **46** |
| FAIL (vi phạm serious/critical **mới** so với baseline) | **0** |
| BLOCKED (có lý do đọc được, không bỏ qua âm thầm) | **37** |
| Vi phạm axe ở **mọi** mức (kể cả minor/moderate) | **0** |
| Cân đối | 46 + 37 = **83** |

37 màn BLOCKED gồm:

- **26 màn Android** (13 customer + 13 operations): không có `adb`/`emulator`/APK, nên cả axe Android lẫn
  TalkBack đều chưa kiểm được — xem §5.
- **11 màn operations web chưa có tuyến trong mã nguồn**: SCR-18, 39, 40, 41, 42, 43, 44, 45, 46, 47, 69.
  Lý do từng màn nằm trong bảng §3; không có bề mặt nào để quét nên không thể "PASS".

Dòng tổng kết do spec in ra (đếm đủ 83, không màn nào biến mất):

```text
[A11Y] DANH MỤC: 83/83 màn · 46 quét được · 37 BLOCKED
[A11Y] TỔNG KẾT: 83 màn = 46 đã quét + 37 BLOCKED = 83 · PASS 46 · FAIL 0 · ERROR 0
```

## 2. Cách chạy lại

Playwright lấy `playwright.config.ts` theo thư mục hiện tại, nên chạy **trong `tests/e2e`**:

```bash
export NODE_OPTIONS=--max-old-space-size=4096
# webServer của config dùng `next start` nên phải dựng trước (một lần cho mỗi app):
pnpm --filter @pinehill/customer-web build
pnpm --filter @pinehill/operations-web build

cd tests/e2e
pnpm exec playwright test a11y/scan.spec.ts --project=customer-web --project=operations-web
```

Chạy từ gốc repo thì phải trỏ config (đường dẫn test tính theo `testDir` = `tests/e2e`):

```bash
pnpm exec playwright test -c tests/e2e/playwright.config.ts tests/e2e/a11y/scan.spec.ts \
  --project=customer-web --project=operations-web
```

Kết quả lượt chạy gần nhất: `50 passed, 120 skipped` (120 skip = 46 màn bị project còn lại bỏ qua +
37 màn BLOCKED × 2 project; mọi skip đều kèm lý do trong log).

- Log từng màn: dòng `[A11Y] <SCR> <surface> PASS|FAIL|ERROR · serious/critical N · mới N · …ms · <path>`,
  kèm từng rule vi phạm (rule id, impact, số node).
- Máy đọc: `tests/e2e/a11y/last-run.json` (tổng hợp) và `tests/e2e/a11y/last-run/<SCR>.json` (từng màn).
  Đây là **artefact sinh ra khi chạy**, đã `gitignore`; chạy lại lệnh trên là có.
- Chỉ chạy một màn: thêm `-g "SCR-25 "` (giữ khoảng trắng cuối để không khớp SCR-250 giả định).

## 3. Bảng đủ 83 màn (PASS / FAIL + rule / BLOCKED + lý do)

Tag axe: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Cột **Kết quả**: PASS = 0 vi phạm
serious/critical; FAIL sẽ ghi `<rule> (<impact>, <n> node)`; BLOCKED ghi lý do.

| Mã | Màn hình | Bề mặt | Tuyến | Kết quả |
|---|---|---|---|---|
| SCR-01 | Trang chủ & khối tìm phòng | customer-web | `/` | PASS (axe 0 serious/critical) |
| SCR-02 | Kết quả tìm phòng | customer-web | `/search?propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0` | PASS (axe 0 serious/critical) |
| SCR-03 | Chi tiết phòng & bảng giá từng đêm | customer-web | `/rooms/synthetic-room?propertyId=synthetic-property&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0` | PASS (axe 0 serious/critical) |
| SCR-04 | Chọn gói giá & chính sách huỷ | customer-web | `/book?propertyId=synthetic-property&roomTypeId=synthetic-room&ratePlanCode=FLEX7&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1` | PASS (axe 0 serious/critical) |
| SCR-05 | Thông tin khách & xác nhận đặt | customer-web | `/book?propertyId=synthetic-property&roomTypeId=synthetic-room&ratePlanCode=FLEX7&checkIn=2026-12-24&checkOut=2026-12-26&adults=2&children=0&roomCount=1` | PASS (axe 0 serious/critical) |
| SCR-06 | Thanh toán trực tuyến | customer-web | `/booking/{bookingId}/pay` | PASS (axe 0 serious/critical) |
| SCR-07 | Kết quả đặt phòng & đếm ngược giữ chỗ | customer-web | `/booking/{bookingId}` | PASS (axe 0 serious/critical) |
| SCR-08 | Đăng ký / đăng nhập khách | customer-web | `/account/login` | PASS (axe 0 serious/critical) |
| SCR-09 | Đơn của tôi | customer-web | `/bookings` | PASS (axe 0 serious/critical) |
| SCR-10 | Chi tiết booking của tôi | customer-web | `/bookings/{bookingId}` | PASS (axe 0 serious/critical) |
| SCR-11 | Huỷ đặt phòng & số tiền hoàn theo bậc | customer-web | `/bookings/{bookingId}/cancel` | PASS (axe 0 serious/critical) |
| SCR-12 | Đổi ngày lưu trú | customer-web | `/bookings/{bookingId}/reschedule` | PASS (axe 0 serious/critical) |
| SCR-13 | Hồ sơ khách & điểm thưởng | customer-web | `/profile` | PASS (axe 0 serious/critical) |
| SCR-14 | Đăng nhập nội bộ & chọn cơ sở | operations-web | `/login` | PASS (axe 0 serious/critical) |
| SCR-15 | Người dùng, vai trò & phạm vi cơ sở | operations-web | `/admin/users` | PASS (axe 0 serious/critical) |
| SCR-16 | Nhật ký kiểm toán | operations-web | `/audit-logs` | PASS (axe 0 serious/critical) |
| SCR-17 | Tham số hệ thống | operations-web | `/system-settings` | PASS (axe 0 serious/critical) |
| SCR-18 | Sao lưu & phục hồi | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có `apps/operations-web/src/app/**/backup*`; F2 chưa giao màn HB tương ứng); không có bề mặt để quét. |
| SCR-19 | Cơ sở | operations-web | `/properties` | PASS (axe 0 serious/critical) |
| SCR-20 | Loại phòng, sức chứa & sàn–trần giá | operations-web | `/room-types` | PASS (axe 0 serious/critical) |
| SCR-21 | Sơ đồ buồng & phòng vật lý | operations-web | `/rooms` | PASS (axe 0 serious/critical) |
| SCR-22 | Khoá phòng bảo trì / ngừng bán | operations-web | `/room-blocks` | PASS (axe 0 serious/critical) |
| SCR-23 | Bảng điều khiển ngày | operations-web | `/day-board` | PASS (axe 0 serious/critical) |
| SCR-24 | Lưới tồn phòng theo ngày | operations-web | `/inventory-grid` | PASS (axe 0 serious/critical) |
| SCR-25 | Allotment theo kênh | operations-web | `/channel-allotments` | PASS (axe 0 serious/critical) |
| SCR-26 | Lịch giá & giá cơ bản | operations-web | `/rate-calendar` | PASS (axe 0 serious/critical) |
| SCR-27 | Mùa & hệ số mùa | operations-web | `/seasons` | PASS (axe 0 serious/critical) |
| SCR-28 | Kênh bán: hệ số & hoa hồng | operations-web | `/channels` | PASS (axe 0 serious/critical) |
| SCR-29 | Khuyến mãi | operations-web | `/promotions` | PASS (axe 0 serious/critical) |
| SCR-30 | Xem trước báo giá đa kênh | operations-web | `/multi-channel-quote` | PASS (axe 0 serious/critical) |
| SCR-70 | Gói giá & chính sách huỷ | operations-web | `/rate-plans` | PASS (axe 0 serious/critical) |
| SCR-31 | Danh sách & tra cứu booking | operations-web | `/bookings` | PASS (axe 0 serious/critical) |
| SCR-32 | Chi tiết booking & nút huỷ | operations-web | `/bookings/b1` | PASS (axe 0 serious/critical) |
| SCR-33 | Tạo booking tại quầy (khách vãng lai) | operations-web | `/bookings/new` | PASS (axe 0 serious/critical) |
| SCR-34 | Tạo booking qua điện thoại | operations-web | `/bookings/new` | PASS (axe 0 serious/critical) |
| SCR-35 | Sửa đổi booking & đổi ngày | operations-web | `/bookings/b1/reschedule` | PASS (axe 0 serious/critical) |
| SCR-36 | Huỷ booking & tính hoàn theo bậc | operations-web | `/bookings/b1/cancel` | PASS (axe 0 serious/critical) |
| SCR-37 | Thu cọc / thu số dư tại quầy | operations-web | `/bookings/b1/collect` | PASS (axe 0 serious/critical) |
| SCR-38 | Yêu cầu & duyệt hoàn tiền hai cấp | operations-web | `/bookings/{bookingId}/refunds` | PASS (axe 0 serious/critical) |
| SCR-39 | Đối soát doanh thu, hoa hồng & công nợ | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có `apps/operations-web/src/app/**/reconciliation*`; F6 chưa giao màn); không có bề mặt để quét. |
| SCR-40 | Cấu hình kênh bán | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (chưa có tuyến cấu hình kênh riêng; `/channels` chỉ là SCR-28 (hệ số & hoa hồng)); không có bề mặt để quét. |
| SCR-41 | Giám sát đồng bộ kênh & outbox | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến giám sát outbox/đồng bộ kênh); không có bề mặt để quét. |
| SCR-42 | Hàng đợi booking OTA nhận vào | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến hàng đợi booking OTA); không có bề mặt để quét. |
| SCR-43 | Bảng điều khiển quá tải | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến bảng điều khiển quá tải (chỉ có báo cáo SCR-55)); không có bề mặt để quét. |
| SCR-44 | Đề xuất & thực hiện điều chuyển phòng | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến điều chuyển phòng); không có bề mặt để quét. |
| SCR-45 | Ghép phòng hai booking | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến ghép phòng); không có bề mặt để quét. |
| SCR-46 | Walk-out & bồi thường | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến walk-out/bồi thường); không có bề mặt để quét. |
| SCR-47 | Duyệt ngoại lệ chính sách | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến duyệt ngoại lệ chính sách); không có bề mặt để quét. |
| SCR-48 | Bàn tiền sảnh: đến – đi – ở trong ngày | operations-web | `/front-desk?date=2026-12-24` | PASS (axe 0 serious/critical) |
| SCR-49 | Hồ sơ khách & danh sách đen | operations-web | `/crm/guests` | PASS (axe 0 serious/critical) |
| SCR-50 | Hạng khách & điểm thưởng | operations-web | `/crm/loyalty?guestId=g1` | PASS (axe 0 serious/critical) |
| SCR-51 | Mẫu & hàng đợi thông báo | operations-web | `/noti/notifications` | PASS (axe 0 serious/critical) |
| SCR-52 | Báo cáo công suất, ADR/RevPAR | operations-web | `/reports/occupancy` | PASS (axe 0 serious/critical) |
| SCR-53 | Báo cáo doanh thu theo kênh | operations-web | `/reports/revenue-by-channel` | PASS (axe 0 serious/critical) |
| SCR-54 | Báo cáo huỷ phòng & hoàn cọc | operations-web | `/reports/cancellations` | PASS (axe 0 serious/critical) |
| SCR-55 | Báo cáo quá tải & điều chuyển | operations-web | `/reports/overbooking` | PASS (axe 0 serious/critical) |
| SCR-69 | Xử lý trả phòng sớm | operations-web | — | BLOCKED — Chưa có tuyến/màn trong mã nguồn (không có tuyến trả phòng sớm; `/front-desk` (SCR-48) chưa mở luồng này); không có bề mặt để quét. |
| SCR-71 | Đăng ký / đăng nhập khách (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-72 | Trang chủ & tìm phòng (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-73 | Kết quả tìm phòng (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-74 | Chi tiết phòng & bảng giá (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-75 | Gói giá & chính sách huỷ (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-76 | Thông tin khách & xác nhận (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-77 | Thanh toán trực tuyến (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-78 | Kết quả đặt phòng (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-79 | Đơn của tôi (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-80 | Chi tiết booking (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-81 | Huỷ booking & số tiền hoàn (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-82 | Đổi ngày lưu trú (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-83 | Hồ sơ khách & điểm thưởng (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-56 | Đăng nhập & chọn cơ sở (PIN) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-57 | Danh sách khách đến hôm nay | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-58 | Chi tiết check-in | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-59 | Thu số dư khi check-in | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-60 | Danh sách khách đi hôm nay | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-61 | Check-out muộn & phụ thu | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-62 | Tra cứu booking & khách | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-63 | Đổi phòng trên Android | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-64 | Ghi no-show | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-65 | Tạo booking khách vãng lai (Android) | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-66 | Buồng phòng: danh sách việc dọn | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-67 | Cảnh báo quá tải & việc gấp | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |
| SCR-68 | Đối soát nhanh theo ngày | android | — | BLOCKED — Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống); TalkBack và axe Android cần thiết bị thật hoặc emulator — chưa có. |

Ghi chú tuyến:

- **SCR-04 / SCR-05** dùng chung `/book` (một luồng 4 bước); SCR-04 quét khối `plan-terms`, SCR-05 quét
  `guest-form` — mỗi màn một dòng đúng danh mục thiết kế.
- **SCR-33 / SCR-34** dùng chung `/bookings/new` (một luồng 5 bước, bước 1 chọn kênh WALKIN/PHONE);
  quét hai lần vì danh mục tách thành hai màn.
- **SCR-08** là một màn nhiều tuyến (`/account/login`, `register`, `forgot-password`,
  `reset-password`); quét tuyến đăng nhập làm đại diện.
- 11 màn operations web BLOCKED chưa có tuyến — xem cột lý do; khi thi công chỉ cần thêm dòng với
  `status: 'scannable'`, `path`, `ready`, `fixture` vào `tests/e2e/a11y/screens.ts`.

## 4. Danh sách lỗi và đề xuất sửa theo màn

**Không có lỗi.** Lượt quét ghi 0 vi phạm ở mọi mức trên cả 46 màn; `tests/e2e/a11y/baseline.json` để
rỗng (`violations: []`), nghĩa là mọi vi phạm serious/critical trong tương lai đều làm đỏ cổng.

Cách ghi khi phát hiện lỗi mới (giữ nguyên tiêu chí, không tắt rule):

1. Log/`last-run.json` đã có `screen`, `rule`, `impact`, `nodes`.
2. Thêm dòng vào `baseline.json` (`screen`, `rule`, `impact`, `nodes`, `note`) **chỉ khi** lead chấp nhận
   nợ kỹ thuật; thêm mục vào bảng dưới đây với đề xuất sửa cụ thể theo màn.
3. Sửa xong thì xoá dòng baseline tương ứng để lỗi tái phát vẫn làm đỏ cổng.

Khuôn mục đề xuất (dùng khi có lỗi):

| Màn | Rule (impact) | Số node | Đề xuất sửa |
|---|---|---|---|
| _chưa có_ | — | 0 | — |

Với 11 màn chưa thi công, đề xuất **bổ sung khi làm màn** (không phải lỗi a11y hiện tại):

| Màn | Thiếu gì | Đề xuất |
|---|---|---|
| SCR-18 Sao lưu & phục hồi | tuyến màn | Khi dựng màn, thêm dòng `scannable` + fixture đọc trạng thái PITR vào bảng quét |
| SCR-39 Đối soát doanh thu | tuyến màn | Thêm fixture đối soát theo ngày rồi quét; chú ý bảng số liệu cần `scope`/header đúng |
| SCR-40 Cấu hình kênh bán | tuyến riêng | Nếu gộp vào `/channels` (SCR-28) thì cập nhật danh mục thiết kế thay vì thêm dòng quét trùng |
| SCR-41 Giám sát đồng bộ kênh | tuyến màn | Fixture outbox có trạng thái FAILED để quét cả bảng và cảnh báo |
| SCR-42 Hàng đợi OTA | tuyến màn | Fixture booking OTA oversold; kiểm bảng + cờ nghi trùng |
| SCR-43 Bảng điều khiển quá tải | tuyến màn | Fixture ca quá tải trễ hạn; kiểm thẻ trạng thái và liên kết hành động |
| SCR-44 Điều chuyển phòng | tuyến màn | Fixture đề xuất PROPOSED/EXECUTED; kiểm bảng so sánh |
| SCR-45 Ghép phòng | tuyến màn | Fixture hai đồng thuận + cảnh báo khác giới |
| SCR-46 Walk-out & bồi thường | tuyến màn | Fixture biên bản ký; kiểm form ký và tổng bồi thường |
| SCR-47 Duyệt ngoại lệ | tuyến màn | Fixture yêu cầu force-majeure; kiểm lý do bắt buộc ≥ 20 ký tự |
| SCR-69 Trả phòng sớm | tuyến màn | Nếu mở trong `/front-desk` thì thêm trạng thái + `ready` cho khối trả phòng sớm |

## 5. TalkBack (Android) — BLOCKED

Không có thiết bị/emulator Android trên máy thi công, nên **không kiểm được** TalkBack đọc luồng chính
(TC-SYS-10 mục Android) và cũng không chạy được axe trên APK. Đây là BLOCKED có bằng chứng, không phải
bỏ qua:

```text
$ command -v adb
adb: NOT FOUND
$ command -v emulator
emulator: NOT FOUND
$ echo "ANDROID_HOME=${ANDROID_HOME:-<unset>}"
ANDROID_HOME=<unset>
$ ls ~/.cache/ms-playwright
chromium-1243  chromium_headless_shell-1243  ffmpeg-1011  webkit-2359
```

26 màn Android (SCR-56…SCR-68, SCR-71…SCR-83) đều được đếm vào 83 với lý do
"Máy thi công không có adb/emulator/APK Android (ANDROID_HOME trống)…". Cần bổ sung khi có thiết bị:
emulator API 34 + APK `apps/*-android` (Maestro flow có sẵn trong `tests/maestro/`), rồi quét axe Android
và kiểm TalkBack theo checklist NFR-USE-03.

## 6. Trình duyệt và khung nhìn

| Cấu hình | Kết quả | Bằng chứng |
|---|---|---|
| Chromium (desktop, project `customer-web` + `operations-web`) | **PASS** — 46/46 màn, 0 vi phạm | log lượt chạy §2 |
| WebKit (project `*-webkit`, `E2E_BROWSERS=webkit`) | **BLOCKED** — thiếu thư viện hệ thống của host | lỗi rút gọn dưới |
| 360 px (NFR-USE-04) | Không thuộc cổng HB-185; đã có ca riêng theo màn (`scr02-03`, `scr13`, `scr24`, `day-board`…) | các spec đó |
| Zoom 200 % | **Chưa có ca tự động** — đề xuất ticket riêng | — |

WebKit đã cài binary nhưng không chạy được trên host này (thiếu `libicu74`, `libjpeg-turbo8` và không
có quyền cài):

```text
$ E2E_BROWSERS=webkit pnpm exec playwright test a11y/scan.spec.ts --project=customer-web-webkit …
Error: browserType.launch:
Host system is missing dependencies to run browsers.
Please install them with the following command:
    sudo pnpm exec playwright install-deps
Alternatively, use apt:
    sudo apt-get install libicu74 libjpeg-turbo8
```

## 7. Quyết định tự đưa ra (AGENTS.md §4)

- Một bảng dữ liệu duy nhất (`screens.ts`) là nguồn cho cả spec và tài liệu; mã SCR lấy đúng danh mục
  thiết kế, không lấy theo tuyến hiện có.
- Màn Android luôn `blocked` vì bề mặt không phải web và không có thiết bị — không giả lập bằng viewport
  web (sẽ là bằng chứng sai).
- Màn web chưa có tuyến ghi `blocked` + lý do cụ thể thay vì bịa fixture; khi có tuyến chỉ cần đổi
  `status`/`path`/`ready`/`fixture`.
- Fixture dùng lại API giả sẵn có của từng màn (`fake-api/f5|f7|f8`, `users`, `refund-fixture`) và bám
  đúng `data-testid` mà spec của màn đang dùng; hai màn dùng chung tuyến (SCR-04/05, SCR-33/34) được
  quét hai lần với selector riêng (SCR-04/05) hoặc cùng bề mặt (SCR-33/34).
- `last-run.json`/`last-run/` là artefact của lần chạy, không commit (xem `tests/e2e/a11y/.gitignore`);
  bằng chứng trong PR là log tổng kết + bảng §3.
- Cổng chỉ đỏ khi có vi phạm **mới** so với `baseline.json`; baseline rỗng nên hiện tại mọi vi phạm
  serious/critical đều làm đỏ.

## 8. Cổng đã chạy

```text
$ cd tests/e2e && pnpm exec playwright test a11y/scan.spec.ts --project=customer-web --project=operations-web
  120 skipped
  50 passed (17.8s)
[A11Y] DANH MỤC: 83/83 màn · 46 quét được · 37 BLOCKED
[A11Y] TỔNG KẾT: 83 màn = 46 đã quét + 37 BLOCKED = 83 · PASS 46 · FAIL 0 · ERROR 0
```

```text
$ pnpm check:scope
Scope: HB-185 cảnh báo (không chặn)
Diff 2420 dòng > max_lines 400 — ghi lý do vào PR (không chặn)
Scope: HB-185 (R0) 8 file, 2420/400 dòng — đạt (có cảnh báo)
```

Lý do vượt 400 dòng: bảng 83 màn + fixture theo từng bề mặt là nội dung bắt buộc của ticket; không có
tệp nào ngoài allow (`tests/e2e/a11y/**`, `docs/07-ban-giao/bang-chung-a11y.md`).
