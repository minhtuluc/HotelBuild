# Backlog F6–F7 — kênh OTA, quá tải, tiền sảnh, vận hành hiện trường

Mục lục: [backlog](backlog.md) · [lộ trình đến deploy](lo-trinh-den-deploy.md) · [sổ tay lead](so-tay-lead.md). Cụm R2 dày nhất sau F5: saga điều chuyển/ghép/walk-out và OTA inbox/outbox phải nguyên tử, idempotent, tất định.

## F6 — kênh OTA, quá tải, điều chuyển, ghép phòng, walk-out (operations web + operations Android)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| HB-120 | Hợp đồng CHAN + OVER: `channels/{id}/sync`, `mappings`, `sales-closure`, `ota-bookings`; `overbooking-cases` (+`relocation-plan`, `resolve`), `room-moves` (+approve/execute), `room-merges` (+consent/approve/execute) + mã `E_CHAN_*`, `E_OVER_*` | R2 | DeepSeek | HB-011, HB-090 | api.md §2, §4.1; FR-CHAN-01…08, FR-OVER-01…17; UC-CHAN-01…03, UC-OVER-01…05 | 0 phá vỡ; client mang Idempotency-Key/If-Match |
| HB-121 | Migration tiến nếu §3 thiếu (`Channel.syncStatus`, `consecutiveSyncFailures`, …) | R2 | Codex | HB-005 | csdl §3; BR-CHAN-07, BR-OVER-03…05 | Schema khớp §3 |
| HB-122 | Engine `OverbookingPlanner` thuần: thang 1 → 2 → 4 (bậc 3 không khả dụng vì 160–300 km), `keepScore` tất định | R2 | Codex | HB-003 | BR-OVER-06, BR-OVER-11, BR-OVER-12; [quá tải](../02-nghiep-vu/qua-tai-ghep-doi-phong.md) §9; TC-OVER-05, TC-OVER-10 | 10.000 lượt cùng đầu vào → cùng thứ tự |
| HB-123 | Engine `RoomMergePolicy` + `WalkOutPolicy`: đồng thuận 2 bên, giới tính, chiết khấu ghép, walk-out | R2 | Codex | HB-003 | BR-OVER-13…15, BR-CANCEL-14; TC-OVER-07, TC-OVER-12, TC-OVER-14 | 0 I/O; doanh thu phòng giữ nguyên |
| HB-124 | Test khoá use case điều chuyển/ghép/walk-out (kiểm lại version + consent + tồn lúc execute; rollback giữ nguồn) | R2 | Codex | HB-121…HB-123, HB-009 | BR-OVER-08…10, BR-OVER-13, BR-OVER-14; TC-OVER-11, TC-OVER-13, TC-OVER-18 | Đỏ trước khi giao HB-125 |
| HB-125 | UC + endpoint OVER: relocation-plan, room-moves, room-merges, resolve; `priceLocked`; PIN khi duyệt/thực thi | R2 | DeepSeek | HB-124, HB-029, HB-015 | BR-OVER-06…15; TC-OVER-08, TC-OVER-09, TC-OVER-16 | Test khoá HB-124 xanh |
| HB-126 | UC + endpoint phát hiện quá tải: gộp theo (cơ sở, ngày, loại phòng), T−24h → ESCALATED | R2 | Codex (test khoá) → DeepSeek | HB-121, HB-122 | BR-OVER-04, BR-OVER-05, BR-OVER-16; TC-OVER-01, TC-OVER-02, TC-OVER-17 | 6 booking vượt → đúng 2 case |
| HB-127 | Worker `q.overbooking-scan` (nhịp 300 giây, cấu hình được) | R2 | Codex | HB-006, HB-126 | BR-OVER-04, BR-OVER-05; TC-OVER-01, TC-OVER-02 | Đẩy đồng hồ giả qua T−24h → leo thang |
| HB-128 | OTA simulator + inbox: `POST /integrations/ota/{channel}/bookings`, HMAC constant-time ±300 giây, chống phát lại 7 ngày, inbox bền trước ACK 202 | R2 | Codex (test khoá) → DeepSeek | HB-120, HB-095 | api.md §5.1; BR-CHAN-02…04, BR-CHAN-06; NFR-SEC-05, NFR-REL-06; TC-CHAN-08, TC-CHAN-09, TC-CHAN-11 | Chữ ký sai → 401; phát lại 5 lần → đúng 1 booking |
| HB-129 | Áp booking OTA (worker): OTA_COLLECT → CONFIRMED kể cả tồn 0, `oversold` + mở case; huỷ thắng sửa | R2 | Codex | HB-128, HB-126 | BR-CHAN-03, BR-CHAN-04, BR-OVER-02, BR-OVER-03; TC-CHAN-03, TC-CHAN-07, TC-CHAN-10 | Không vượt allotment còn lại |
| HB-130 | Outbox relay `q.outbox-relay` + `event_deliveries` (lease, dedup, dead letter sau 5 lần) | R2 | Codex | HB-006, HB-091 | ADR-017; BR-CHAN-06, BR-CHAN-07; TC-CHAN-02 | Tiến trình chết không mất sự kiện; phát lại không tạo bản ghi thứ hai |
| HB-131 | UC + endpoint CHAN còn lại + `q.channel-sync` 5 phút; 3 lỗi → DEGRADED + cảnh báo | R2 | Codex (test khoá) → DeepSeek | HB-130 | BR-CHAN-01, BR-CHAN-02, BR-CHAN-05, BR-CHAN-07, BR-CHAN-08; NFR-REL-03; TC-CHAN-04, TC-CHAN-05 | `syncStatus=DEGRADED`, `consecutiveSyncFailures=3` |
| HB-132 | SCR-40 cấu hình kênh bán | R1 | DeepSeek | HB-131, HB-020 | SCR-40; UC-CHAN-01; BR-OVER-02, BR-CHAN-01 | Vượt trần → thông điệp đúng |
| HB-133 | SCR-41 giám sát đồng bộ & outbox | R1 | DeepSeek | HB-131 | SCR-41; UC-CHAN-02; BR-CHAN-07 | Có nút đẩy lại; mốc cập nhật |
| HB-134 | SCR-42 hàng đợi booking OTA nhận vào | R1 | DeepSeek | HB-129 | SCR-42; UC-CHAN-03; BR-CHAN-03 | Cờ nghi trùng; mở case |
| HB-135 | SCR-43 bảng điều khiển quá tải | R1 | DeepSeek | HB-126 | SCR-43; UC-OVER-01; BR-OVER-16; TC-OVER-16 | ESCALATED không tự đóng |
| HB-136 | SCR-44 đề xuất & thực hiện điều chuyển (bảng `keepScore` đầy đủ, lý do bậc 3) | R1 | DeepSeek | HB-125, HB-135 | SCR-44; UC-OVER-02; BR-OVER-06, BR-OVER-08 | Không lược bảng `keepScore` |
| HB-137 | SCR-45 ghép phòng + SCR-46 walk-out | R1 | DeepSeek | HB-125 | SCR-45, SCR-46; UC-OVER-03, UC-OVER-04; TC-OVER-11, TC-OVER-13 | Thiếu đồng thuận → `E_OVER_NO_CONSENT` |
| HB-138 | SCR-47 duyệt ngoại lệ chính sách | R1 | DeepSeek | HB-125 | SCR-47; UC-OVER-05; BR-OVER-07 | Lý do < 20 ký tự bị chặn |
| HB-139 | SCR-63 đổi phòng + SCR-67 cảnh báo quá tải (operations Android, Maestro) | R1 | DeepSeek | HB-125, HB-022 | SCR-63, SCR-67; UC-OVER-02; TC-OVER-15; NFR-USE-05 | Đổi phòng bậc 1–2 ≤ 30 giây |
| HB-194 | QA F6 (Chromium + WebKit + Maestro) | R0 | Gemini | HB-132…HB-139 | TC-CHAN-02…11, TC-OVER-01…18 | Log đầy đủ |
| HB-195 | Nghiệm thu F6 (mốc M7) | — | lead | HB-194 | lộ trình §7.8 | Bằng chứng đủ |

## F7 — tiền sảnh & vận hành hiện trường (operations web + operations Android)

**Đặc tả đủ (03/10/2026, lead).** Codex: engine HB-141/HB-142, test khoá HB-143, offline HB-159; DeepSeek: hợp đồng, use case (HB-144/145/147 theo test khoá), màn hình; Gemini: QA HB-196.

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| [HB-140](tickets/HB-140-hop-dong-f7.md) | Hợp đồng FO: check-in, check-out, no-show, housekeeping tasks, reconciliation close, `GET/POST /guests`, walk-in + mã `E_FO_CHECKIN_NOT_ALLOWED` | R2 | DeepSeek | HB-090 | api.md §2; FR-FO-01…08, FR-CRM-01; UC-FO-01…04 | 0 phá vỡ |
| [HB-141](tickets/HB-141-engine-check-in.md) | Engine `CheckInPolicy`: ngưỡng nợ (≤ 5.000.000 ₫ và ≤ 50%), sau 23:59 → no-show | R2 | Codex | HB-003 | BR-FO-01, BR-FO-02; TC-FO-01, TC-FO-02 | 0 I/O |
| [HB-142](tickets/HB-142-engine-check-out.md) | Engine `CheckOutFeePolicy`: phụ thu muộn 0/50/100%, check-in sớm 0/30%/+1 đêm | R2 | Codex | HB-003 | BR-FO-03, BR-FO-04; TC-FO-03, TC-FO-04 | 11:30/15:00/19:00 → 0/550.000/1.100.000 |
| [HB-143](tickets/HB-143-test-khoa-tien-sanh.md) | Test khoá check-in/out (PIN, chốt số dư, sinh HousekeepingTask, chặn giao phòng chưa dọn) | R2 | Codex | HB-141, HB-142, HB-009 | BR-FO-01, BR-FO-05…07, BR-RBAC-05; TC-FO-05, TC-FO-06 | Đỏ trước khi giao |
| [HB-144](tickets/HB-144-uc-check-in.md) | UC + endpoint check-in | R2 | DeepSeek (test khoá HB-143) | HB-143, HB-029 | UC-FO-01; BR-FO-01, BR-FO-02; TC-FO-01 | Test khoá xanh |
| [HB-145](tickets/HB-145-uc-check-out.md) | UC + endpoint check-out (extras, muộn/sớm, PIN) | R2 | DeepSeek (test khoá HB-143) | HB-143 | UC-FO-02; BR-FO-03, BR-FO-05, BR-FO-06, BR-CANCEL-09; TC-FO-05 | Thu đủ → giải phóng + sinh task |
| ~~HB-146~~ | Gộp vào HB-096 (thu tiền tại quầy) | — | — | — | — | — |
| [HB-147](tickets/HB-147-uc-no-show.md) | No-show + worker `q.no-show-mark` lúc 23:59 | R2 | DeepSeek (test khoá HB-143) | HB-143, HB-006 | UC-FO-04; BR-CANCEL-10; TC-FO-07 | Hiện số tiền trước xác nhận |
| [HB-148](tickets/HB-148-uc-buong-phong.md) | Buồng phòng: `GET/PATCH /housekeeping/tasks`; HOUSEKEEPING chỉ thấy dữ liệu nhiệm vụ tối thiểu | R1 | DeepSeek | HB-143, HB-014 | UC-FO-03; BR-RBAC-03, BR-FO-06, BR-FO-07 | Không lộ DTO booking/tài chính |
| [HB-149](tickets/HB-149-uc-khach-tai-quay.md) | CRM tại quầy: `GET/POST /guests`, SĐT chuẩn hoá, chặn khách blacklist khi check-in | R1 | DeepSeek | HB-140, HB-014 | UC-CRM-01; BR-CRM-01, BR-CRM-04; NFR-COMP-01 | SĐT sai → `E_CRM_PHONE_INVALID` |
| [HB-150](tickets/HB-150-uc-chot-doi-soat-ngay.md) | Chốt đối soát ngày `POST /reconciliation/daily/close` theo (người thu, ngày VN) | R1 | DeepSeek | HB-096 | UC-PAY-05; BR-PAY-06, BR-PAY-10 | Cảnh báo lệch ngưỡng |
| [HB-151](tickets/HB-151-uc-walk-in.md) | Walk-in `POST /bookings` kênh WALKIN | R1 | DeepSeek | HB-077 | UC-BOOK-02; FR-BOOK-02; TC-BOOK-17 | ≤ 5 bước ≤ 3 phút |
| [HB-152](tickets/HB-152-scr48-ban-tien-sanh.md) | SCR-48 bàn tiền sảnh (operations web) | R1 | DeepSeek | HB-144, HB-145, HB-147 | SCR-48; UC-FO-01, UC-FO-02, UC-FO-04 | Nút check-in mờ khi nợ vượt ngưỡng |
| [HB-153](tickets/HB-153-scr57-58-check-in-android.md) | SCR-57 + SCR-58 đến & check-in (Android, Maestro) | R1 | DeepSeek | HB-144, HB-022 | SCR-57, SCR-58; UC-FO-01; NFR-USE-05 | 3 chạm ≤ 60 giây |
| [HB-154](tickets/HB-154-scr59-61-thu-tien-check-out-android.md) | SCR-59 + SCR-60 + SCR-61 thu số dư, đi hôm nay, check-out muộn (Android) | R1 | DeepSeek | HB-145, HB-096 | SCR-59, SCR-60, SCR-61; UC-FO-02; TC-FO-06 | Check-out 4 chạm ≤ 90 giây |
| [HB-155](tickets/HB-155-scr64-no-show-android.md) | SCR-64 no-show (Android) | R1 | DeepSeek | HB-147 | SCR-64; UC-FO-04; TC-FO-07 | 4 chạm ≤ 45 giây |
| [HB-156](tickets/HB-156-scr62-tra-cuu-android.md) | SCR-62 tra cứu booking & khách (Android) | R1 | DeepSeek | HB-149, HB-022 | SCR-62; UC-BOOK-07, UC-CRM-01 | Hiện cờ blacklist |
| [HB-157](tickets/HB-157-scr65-walk-in-android.md) | SCR-65 walk-in (Android) | R1 | DeepSeek | HB-151, HB-022 | SCR-65; UC-BOOK-02; TC-BOOK-17 | ≤ 5 bước |
| [HB-158](tickets/HB-158-scr66-68-buong-phong-doi-soat-android.md) | SCR-66 buồng phòng + SCR-68 (Android) | R1 | DeepSeek | HB-148 | SCR-66, SCR-68; UC-FO-03; BR-RBAC-03 | Từ chối camera không chặn luồng |
| [HB-159](tickets/HB-159-hang-doi-offline-android.md) | Hàng đợi offline Android (sau khi chốt OPEN-02): bản nháp → chờ đồng bộ → đang gửi → đã xác nhận / cần xử lý; không báo thành công tài chính khi offline | R2 | Codex (test khoá) → DeepSeek | HB-153, HB-154, HB-029 | BR-GEN-08, BR-RBAC-05; api.md §1.6; TC-FO-08 | Không lưu PIN; quá TTL idempotency thì tra kết quả trước |
| [HB-196](tickets/HB-196-qa-f7.md) | QA F7 (Chromium + WebKit + Maestro) | R0 | Gemini | HB-152…HB-159 | TC-FO-01…08, TC-BOOK-17 | Log đầy đủ |
| [HB-197](tickets/HB-197-nghiem-thu-f7.md) | Nghiệm thu F7 | — | lead | HB-196 | lộ trình §7.9 | Bằng chứng đủ |

## Khoảng trống tài liệu

1. Nhịp quét quá tải: kế hoạch sprint ghi "mỗi giờ", tài liệu quá tải dùng 5 phút → mặc định 300 giây (cấu hình).
2. TC-OVER-13 trả `E_OVER_NO_CONSENT` cho ca thiếu duyệt khác giới, chồng với `E_OVER_MERGE_GENDER` — chốt ranh giới khi viết HB-124.
3. `q.channel-sync`, `q.overbooking-scan` chưa đặt lặp trong `apps/worker/src/queues.ts` — bổ sung trong HB-127/HB-131.
4. FRONT_DESK có được đọc HousekeepingTask cho SCR-48 không — xác nhận api.md §6.3 khi viết HB-148.
5. SCR-68 nằm ở PAY Android trong catalogue nhưng lộ trình xếp vào F7 — tạm gộp HB-158.
