# Bằng chứng QA F7 — tiền sảnh (web + Android)

**Ngày chạy:** 23/10/2026 · **Môi trường:** Linux 7.2.11 (Fedora 44), Node `v22.23.1`, pnpm `10.34.5`, PostgreSQL `16.15` (`127.0.0.1:5432`), Redis `7.4.11` (`127.0.0.1:6379/21`) · **Revision:** xem §6.

Căn cứ: [HB-196](../08-thi-cong/tickets/HB-196-qa-f7.md), `TC-FO-01…08`, `TC-BOOK-17` ([kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md)), [lộ trình thi công](../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.9, [quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) (BR-FO-01…07, BR-CANCEL-06/10, BR-PAY-01/02, BR-RATE-06/07, BR-GEN-03, BR-RBAC-03/05, BR-SYS-05), [api.md](../04-thiet-ke/api.md) §2.9.

Phạm vi: **chạy thật và đối chiếu độc lập** mã F7 đã có trên `main` (`50352a0`): `POST /walk-in`, `POST /payments`, `POST /front-office/{check-in,check-out,no-show}`, `GET/PATCH /housekeeping/tasks`, cùng 4 màn Android HB-153/154/155/157 ở tầng logic. **Không sửa mã sản phẩm.** Sản phẩm của lượt QA nằm ở [`tests/e2e/f7/`](../../tests/e2e/f7): [`qa-f7-frontdesk.mjs`](../../tests/e2e/f7/qa-f7-frontdesk.mjs) (kịch bản), [`qa-f7-lib.mjs`](../../tests/e2e/f7/qa-f7-lib.mjs) (hạ tầng), [`clock-shim.mjs`](../../tests/e2e/f7/clock-shim.mjs) (đồng hồ).

## 1. Kết quả đã chạy

| Phép kiểm | Lệnh | Kết quả | Giới hạn của bằng chứng |
|---|---|---|---|
| **Luồng F7 trên API thật + CSDL riêng + seed dev**, đối chiếu biểu thức/SQL độc lập | `DATABASE_MIGRATION_URL=… REDIS_URL=…/21 node tests/e2e/f7/qa-f7-frontdesk.mjs` | **111 PASS / 1 FAIL / 5 FINDING**, ~14 giây, thoát mã 1. FAIL duy nhất là **F7-QA-03** (§3) — lệch thật của mã, **không** nới phép kiểm | Xem §2 về đồng hồ giả và điều kiện đầu bằng SQL |
| Tạo booking vãng lai, giá/cọc/mã/snapshot (`TC-BOOK-17`, API) | trong script (29 PASS) | **PASS** — giá từng đêm, tổng ⌊Σ⌋1.000, cọc ⌈%⌉1.000 khớp biểu thức viết từ BR-RATE-06/07, §4.4 LOS, BR-GEN-03, BR-PAY-01 trên 9 booking (FLEX7/SAVER3/NONREF; STD/SUP/DLX/FAM; thứ Sáu–thứ Hai); mã `PH-YYMMDD-NNNNN`, kênh `WALKIN`, đúng 1 `PriceSnapshot`, Σ nghĩa vụ ROOM = tổng (BR-RATE-16) | Chỉ booking **1 phòng** — nhiều phòng lệch, xem F7-QA-03 |
| Ngưỡng nợ và duyệt nợ (`TC-FO-01`) | trong script (12 PASS) | **PASS** — đủ tiền → FRONT_DESK nhận phòng; nợ ≤ 5.000.000 và ≤ 50% → FRONT_DESK bị chặn, MANAGER duyệt, `AuditLog` `CHECKIN_DEBT_APPROVED` có lý do + hạn thu = ngày trả + số nợ; nợ 70% (vượt một ngưỡng) → MANAGER **bị chặn**; nợ 8.205.000 (70% của 11.722.000) vượt cả hai → MANAGER chặn, chỉ OWNER duyệt (audit ghi vai trò OWNER); sai ngày → 409 | Ngưỡng đọc từ `SystemSetting` mặc định (5.000.000/50%); chưa đổi cấu hình |
| Mốc 23:59 (`TC-FO-02`, BR-FO-02) | trong script (2 PASS + 2 liên quan) | **PASS** — 23:58:50 nhận được; đúng 23:59:00 bị từ chối (yêu cầu xử lý no-show); 00:30 hôm sau bị từ chối | Biên 23:59:00 kiểm bằng độ trễ vài chục ms của đồng hồ giả |
| Phụ thu trả muộn ba mốc (`TC-FO-03`) | trong script (8 PASS) | **PASS** — 11:30 → 0; 15:00 → 50%; 19:00 → 100% **giá đêm cuối** đọc từ `booking_charges` (DLX 1.210.000 → 0 / 605.000 / 1.210.000; STD thứ Bảy 858.000 → 429.000); lần gọi đầu 422 “còn số dư phải thu”, phụ thu chốt thành nghĩa vụ, thu bằng PIN rồi trả phòng 200, không nhân đôi khi gọi lại | Giờ lấy từ `CLOCK` (đồng hồ giả); cột `checked_out_at` dùng giờ CSDL thật (ADR-014) |
| Phụ thu nhận sớm (`TC-FO-04`) | trong script (7 PASS) | **PASS** — 06:30 từ chối “đặt thêm một đêm”; 09:00 → 0; 13:00 → ⌈30% × đêm đầu 1.122.000⌉1.000 = 337.000, ghi thành nghĩa vụ `EXTRA_SERVICE`, số dư = phụ thu | Phòng đã `DONE` bằng SQL (F7-QA-01) |
| Trả phòng → việc dọn → giao phòng (`TC-FO-05`, **AC1**) | trong script (4 + 12 PASS) | **PASS** — còn nợ thì 422 và giữ `CHECKED_IN`; thu đủ → `CHECKED_OUT`, `balanceDue = 0`, 1 `HousekeepingTask` `PENDING` ngày trả phòng, `room_assignments.released_at` được ghi; khách kế tiếp **không** được giao khi việc dọn `PENDING`/`IN_PROGRESS`, được giao (201) ngay khi `DONE` qua API | Việc dọn đi API thật: FRONT_DESK phân công → HOUSEKEEPING `IN_PROGRESS` → `DONE` |
| No-show (`TC-FO-07`, phần API) | trong script (4 PASS) | **PASS** — trước 23:59 bị từ chối; 23:59:30 → `NO_SHOW`, phạt = max(0, đêm đầu 858.000 − đã thu 258.000) = **600.000** (BR-CANCEL-06), phòng giải phóng, không hoàn cọc, `refundRequestId = null`; không nhận phòng được nữa | Chỉ API; worker `q.no-show-mark` xem §2 |
| **AC3** RBAC / dữ liệu tối thiểu / PIN / idempotency | trong script (≥ 21 PASS) | **PASS** — HOUSEKEEPING, RESERVATION_AGENT, ACCOUNTANT, SYSADMIN → 403 cả check-in/check-out/no-show; không token → 401; trường lạ → 400; FRONT_DESK CS-01 với booking CS-02 → 403/404; thiếu `Idempotency-Key` → 4xx; HOUSEKEEPING: DTO việc dọn chỉ 9 trường (không booking/khách/tiền), `GET /bookings`, `/bookings/{id}`, `/balance`, `/guests`, `POST /payments` → 403; chỉ thấy việc **được giao**; check-out thiếu `pinToken` và `pinToken` của booking khác bị từ chối; phát lại cùng khoá → cùng phản hồi và đúng 1 dòng lịch sử | PIN sai/khoá 15 phút không kiểm (tránh khoá tài khoản dev dùng chung) |
| Logic Android HB-153/154/155/157, kể cả **offline** | `cd apps/operations-android && pnpm exec vitest run test/arrivals test/no-show test/stay test/walk-in` | **PASS — 18 tệp / 141 ca** (chạy lại trên `50352a0`). Ca offline: `arrivals-writer` (offline không gửi, không xếp hàng), `arrivals-ui` (“offline confirm sends nothing”), `no-show-writer/ui`, `stay-writer` + `stay-ui` (“offline: neither unlock nor submit reaches the network”), `walk-in-flow` + `walk-in-ui` (“offline create/verify/pay send nothing”) | Test logic + harness giao diện, **không phải** thiết bị thật |
| Ước lượng thời gian walk-in (`TC-BOOK-17`) | `test/walk-in-timing.spec.ts` (nằm trong lượt trên) | 20 lượt mô phỏng: 5 bước, 27,7–28,1 s | **Mô phỏng logic với đồng hồ bơm vào**, không phải đo người thật (NFR-USE-05 chưa chứng minh) |
| Bàn tiền sảnh SCR-48, axe + 360 px (Chromium) | `E2E_API_BASE_URL=http://127.0.0.1:4150/api/v1 E2E_CUSTOMER_WEB_PORT=3150 E2E_OPERATIONS_WEB_PORT=3151 E2E_BROWSERS=chromium,webkit pnpm exec playwright test -c tests/e2e/playwright.config.ts ops-front-desk.spec.ts` (sau `pnpm --filter … build`) | **Chromium 19/19 PASS**: 9 trạng thái §8.1 + 360 px, axe 0 serious/critical | **API giả E2E**, không phải API thật. WebKit: xem §2 |
| Số chạm khai báo trong kịch bản Maestro | đọc `tests/maestro/hb153-*, hb154-*, hb155-*, hb157-*` | Khai báo: nhận phòng 3 chạm từ Home (mở danh sách → mở thẻ → xác nhận), no-show 4, trả phòng 4 (mở danh sách → thẻ → mở PIN → xác nhận), walk-in 5 bước | **Là số khai báo trong kịch bản, không phải số đo** |

## 2. Chưa chạy (NOT_RUN) và bị chặn (BLOCKED)

| Hạng mục | Trạng thái | Lý do / điều kiện gỡ |
|---|---|---|
| **Maestro trên Android (AC2: đo chạm/thời gian; `TC-FO-06`, `TC-FO-07` UI, `TC-BOOK-17` thiết bị)** | **BLOCKED** | Máy không có `maestro`, không có thiết bị/emulator. Kịch bản đã có ở `tests/maestro/hb153-*, hb154-*, hb155-*, hb157-*` nhưng **chưa chạy**; mọi số chạm/giây ở trên là khai báo hoặc mô phỏng, không phải kết quả đo |
| **WebKit (NFR-USE-04)** | **BLOCKED** | `webkit-2359` đã cài nhưng không khởi động: `browserType.launch: Host system is missing dependencies … sudo pnpm exec playwright install-deps` (thiếu `libicu74`, `libjpeg-turbo8` …); 19 ca `operations-web-webkit` **fail vì môi trường**, không phải vi phạm sản phẩm. Gỡ: máy có `install-deps` (hoặc CI Ubuntu) |
| TalkBack / trợ năng Android thật | **BLOCKED** | Không có thiết bị. Nhãn trợ năng chỉ có test logic của từng màn |
| `TC-FO-08` khởi động lại app / mất mạng **sau** commit | **NOT_RUN** | Cần thiết bị; hàng đợi offline HB-159 không nối vào màn tiền sảnh (đúng thiết kế: thao tác tiền không xếp hàng) nên chỉ kiểm “không gửi khi offline” bằng Vitest |
| Worker `q.no-show-mark` lúc 23:59 | **NOT_RUN** | Lượt này chỉ kiểm lệnh tay `POST /front-office/no-show`; job đã có test khoá riêng (HB-147) |
| Hiển thị số tiền no-show/phụ thu trả muộn **trước** khi xác nhận (`TC-FO-07` “Hộp thoại hiện số tiền bị tính”) | **Không đạt được bằng API hiện có** | Không có tuyến xem trước (đã ghi TD-28). Ngoài tầm lượt QA; xem §3 mục ghi chú |
| API giả vs API thật cho giao diện web | **NOT_RUN** | Giao diện chỉ chạy trên API giả E2E; chưa có lượt Playwright trỏ vào API thật (`fake-api` là cầu nối cho cả hai web) |

**Đồng hồ và điều kiện đầu — cần biết khi đọc kết quả.**

- API thật được chạy qua [`clock-shim.mjs`](../../tests/e2e/f7/clock-shim.mjs) (`node --import`) cộng độ lệch vào `Date`/`new Date()` để dựng các mốc 06:30 / 09:00 / 13:00 / 23:59 / 00:30 trong cùng một lượt. Mọi **quyết định theo giờ** (`CLOCK`) đi qua đồng hồ giả; cột dùng `clock_timestamp()`/`now()` của PostgreSQL (ví dụ `checked_in_at`, hạn giữ chỗ của walk-in 15 phút) vẫn là giờ thật theo ADR-014. Vì vậy script tạo booking + thu cọc **trước** khi nhảy giờ và dùng ngày VN thật làm `D`.
- Điều kiện đầu **bằng SQL** (không có đường API): nhiệm vụ buồng phòng `DONE` cho ngày nhận phòng của các phòng lần đầu được giao (F7-QA-01) và nhiệm vụ ngày D+5 trong đối chứng của F7-QA-05.
- Hệ số giá lấy từ CSDL seed (`room_types`, `channels.multiplier`, `system_settings`), không từ phản hồi API.

## 3. Lỗi và lệch phát hiện

| Mã | Mức | Phát hiện | Bằng chứng |
|---|---|---|---|
| **F7-QA-03** | **Cao** (tiền) — **FAIL** trong script | **Booking nhiều phòng bị tính giá bằng một phòng.** `totalAmount` không nhân với `roomCount`; giá một đêm bị chia đều cho các `BookingRoom`. Thu cọc, số dư, phạt no-show, hoàn tiền, báo cáo doanh thu đều thấp hơn thực tế | Walk-in DLX 2 phòng × 1 đêm (thứ Sáu): API `totalAmount` **1.452.000**, kỳ vọng 2 × 1.452.000 = **2.904.000**; `booking_rooms.price_per_night` = 726.000 + 726.000; `POST /quotes` cùng kỳ SUP `roomCount` 1 / 2 / 3 → total **935.000 / 935.000 / 935.000**. Nguồn: `apps/api/src/modules/book/bookings/snapshot.ts` `planSnapshot` phân bổ `quote.total` (giá một phòng) cho `roomCount × đêm`; `packages/domain/src/pricing` không có `roomCount` |
| **F7-QA-04** | Trung bình (vận hành) | **Check-in booking nhiều phòng phụ thuộc thứ tự `actualRoomIds` mà client không biết.** Mã ánh xạ `actualRoomIds[i]` ↔ `booking_rooms ORDER BY id` (UUID); chọn đúng các phòng đã gán nhưng khác thứ tự → `409 E_INV_ROOM_TAKEN` “Lịch phòng đã thay đổi” | Booking DLX×2 đã gán sẵn 2 phòng: đảo thứ tự → 409; đúng thứ tự → 201 (script `3a`). `facts.ts` (`orderBy id`) và `writes.ts` `assignActualRooms` (giải phóng dòng cũ rồi chèn phòng đang giữ bởi `BookingRoom` kia → vi phạm `excl_room_assignments`). Android/web chọn phòng theo mã; không có API đọc phòng đã gán |
| **F7-QA-01** | Trung bình (đưa vào vận hành) | **Không có đường API tạo nhiệm vụ buồng phòng cho phòng mới.** Task chỉ sinh trong check-out ⇒ lần giao đầu tiên của mọi phòng chưa từng trả luôn `409 chưa sẵn sàng`. BR-FO-07: “chưa có task/bằng chứng sẵn sàng phải kiểm tra và ghi nhận” nhưng không có API ghi nhận | Check-in lúc 10:00 một booking đủ tiền → 409 “Phòng thực tế chưa sẵn sàng để giao cho khách”; `POST /housekeeping/tasks` → 404. Script phải `INSERT` SQL việc `DONE` để chạy tiếp |
| **F7-QA-05** | Trung bình (vận hành) | **Sẵn sàng chỉ đọc nhiệm vụ có `businessDate` = ngày nhận phòng.** Phòng dọn xong ngày trả phòng nhưng khách kế tiếp đến **ngày sau** vẫn bị 409; không job/endpoint nào tạo việc cho ngày đó. BR-FO-07 viết “task gần nhất của lần giải phóng đó” nên hai cách đọc lệch nhau | Phòng trả D+4, việc dọn D+4 `DONE` qua API; khách nhận D+5 → 409; chỉ sau khi chèn việc `DONE` ngày D+5 mới 201. `facts.ts` `readinessTasks` lọc theo ngày (cố ý, có chú thích) |
| **F7-QA-02** | Thấp (truy vết) | **Lượt check-in bị từ chối không để lại nhật ký.** Mã ghi `CHECKIN_REFUSED` rồi rollback cùng transaction ⇒ BR-SYS-05 “ai, booking nào, lý do” cho lượt từ chối không truy vết được; chỉ bắt lỗi hạ tầng audit | Sau 2 lượt M1 bị 409: `SELECT count(*) FROM audit_logs WHERE action='CHECKIN_REFUSED' AND entity_id=<M1>` = **0**. Chú thích `service.ts` nói rõ “không lưu lại” — cần lead xác nhận có phải ý định |

Ghi chú không phải lỗi mã: (1) phí trả muộn/phạt no-show chỉ biết **sau** khi gọi lệnh ghi (TD-28), nên giao diện Android nêu hệ quả bằng chữ rồi hiện số máy chủ trả; (2) `lateCheckOut` do client gửi nhưng mức phụ thu do máy chủ tính từ giờ — kiểm cờ sai trên cùng booking chưa làm.

Phát hiện quy trình: lượt đầu của script bị chặn bởi hold 15 phút tính theo giờ CSDL thật khi nhảy đồng hồ API; sửa bằng cách thu cọc trước khi nhảy giờ (xem §2), **không** tắt kiểm.

## 4. Sản phẩm của lượt QA

- [`tests/e2e/f7/qa-f7-frontdesk.mjs`](../../tests/e2e/f7/qa-f7-frontdesk.mjs) — tạo CSDL `hb196_qa_*`, `scripts/migrate.mjs`, `db:seed`, đặt PIN, chạy **API thật** với đồng hồ giả, đi hết luồng F7 qua HTTP, đối chiếu bằng biểu thức/SQL độc lập; xoá CSDL khi xong. `PASS/FAIL` là kết luận phép kiểm, `FINDING` là lệch cần lead xem.
- [`tests/e2e/f7/qa-f7-lib.mjs`](../../tests/e2e/f7/qa-f7-lib.mjs), [`tests/e2e/f7/clock-shim.mjs`](../../tests/e2e/f7/clock-shim.mjs) — hạ tầng.

Cổng (chạy trên bản này): `pnpm check:scope`, `npm run check:docs`, `pnpm typecheck:e2e`, `prettier --check` — kết quả ghi ở PR.

## 5. Kết luận tự đánh giá

- **AC1 đạt** ở tầng API thật: walk-in → thu cọc (PIN) → nhận phòng → phụ thu muộn → trả phòng → việc dọn → giao phòng cho khách kế tiếp chạy đầu–cuối, số khớp biểu thức độc lập — **với điều kiện đầu bằng SQL cho lần giao đầu tiên của phòng (F7-QA-01)**.
- **AC2 chưa đạt/BLOCKED:** không có Maestro và thiết bị; chỉ có số chạm khai báo và mô phỏng logic.
- **AC3 đạt ở API và logic:** HOUSEKEEPING không thấy tiền/khách (DTO tối thiểu, 403 các tuyến booking/khách/tiền); offline không gửi và không báo thành công (141 ca Vitest). Chưa kiểm trên thiết bị.
- **Có một lệch mức cao về tiền (F7-QA-03)** và ba lệch vận hành (F7-QA-01/04/05) cần lead quyết định trước khi coi F7 là xong; HB-197 không nên ký khi F7-QA-03 còn mở.
- Bằng chứng **không** phủ các nhánh ở §2 (Maestro, WebKit, TalkBack, khởi động lại app, worker no-show, giao diện trên API thật).

## 6. Revision và cách tái lập

- **Revision:** commit `test(HB-196)` trên nhánh `ticket/HB-196-qa-f7` (SHA ghi ở PR); bằng chứng này nằm trong cùng commit bàn giao. Chạy trên nền `main` = `50352a0`.
- Tái lập: `pnpm install --frozen-lockfile` rồi
  `DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:5432/pinehill' REDIS_URL='redis://127.0.0.1:6379/21' node tests/e2e/f7/qa-f7-frontdesk.mjs` (cần PG16 + Redis7 dev đang chạy; thoát mã 1 chừng nào F7-QA-03 còn mở);
  Android: `cd apps/operations-android && pnpm exec vitest run test/arrivals test/no-show test/stay test/walk-in`;
  web: `pnpm --filter @pinehill/operations-web build && pnpm --filter @pinehill/customer-web build` rồi lệnh Playwright ở §1 (thêm cổng riêng nếu có lượt khác đang chạy).
