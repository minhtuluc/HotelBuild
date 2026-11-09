# HB-194 — bằng chứng QA F6 (CHAN/OVER) trên API thật

**Kết luận: CHƯA ĐẠT M7.** Lượt chạy trên nhánh `ticket/HB-194-qa-f6-chay-that` (base `main` `059cdd8`): CHAN và web ở commit `2955d70a19c4357f34056d5c05642e7012892259`, OVER chạy lại ở `587299c` (chỉ sửa cách đo TC-OVER-14 theo định nghĩa doanh thu của test khoá HB-124). Nghiệp vụ lõi CHAN/OVER chạy đúng trên API + worker thật (chữ ký, phát lại, OTA vào thẳng `CONFIRMED`, quota, đóng/mở bán, DEGRADED, ca quá tải gộp/leo thang/không tự đóng, thang 1→2→4, nâng hạng giữ giá, walk-out có duyệt, ghép phòng giữ doanh thu), nhưng có **3 lỗi P1 chặn dùng thật** — SCR-43 không tải được trên API thật (sửa ở #269), walk-out từ giao diện không thực thi được (sửa ở #270), nâng hạng không báo khách — và các lệch P2 ở §4. Android/Maestro/WebKit BLOCKED theo khả năng của host.

Căn cứ: [HB-194](../08-thi-cong/tickets/HB-194-qa-f6.md), [kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-01…11, TC-OVER-01…18, [BR](../02-nghiep-vu/quy-tac-nghiep-vu.md) CHAN/OVER.

## 1. Môi trường và lệnh

| Mục | Giá trị |
| --- | --- |
| Host | Fedora 44, Linux 7.2.13, Node v22.23.1 |
| CSDL / Redis | PostgreSQL 16.15 (container `pinehill-dev-postgres-1`), Redis 7.4.11 DB `/10`; mỗi script tạo CSDL tạm `hb117_qa_*`, migrate + seed dev, xoá khi xong |
| API / worker | `apps/api` + `apps/worker` chạy bằng `tsx` từ mã nguồn, đồng hồ nghiệp vụ điều khiển được (`tests/e2e/f7/clock-shim.mjs`, nay nạp cho cả worker qua `QA_WORKER_CLOCK=1`) |
| Web | `apps/operations-web` `next start` (build cùng commit) sau proxy cùng-origin; Playwright 1.63.0, Chromium 153.0.8010.12 |
| Simulator OTA | `scripts/simulators/ota/simulator.ts` (HB-128) + bộ gửi webhook ký HMAC của harness (`tests/e2e/f6-qa/qa-f6-lib.mjs::otaSend`, cùng hợp đồng `t + "." + rawBody`) |
| Bên nhận đồng bộ | máy chủ HTTP cục bộ trong `qa-f6-chan.mjs`, đặt vào `system_settings['chan.ota.simulator.baseUrl']` |

Cấu hình QA (đổi qua SystemSetting, không sửa mã): `job.channelSync.intervalSeconds = 20` (seed 300), `job.overbooking.scanIntervalMinutes = 1` (seed 60), `alerts.recipient.manager = qa-manager@example.test`, account OTA tổng hợp `chan.ota.accounts`; ánh xạ STD/SUP/DLX/FAM/DOR của CS-01 cho ba OTA qua `PUT /channels/{id}/mappings` (OWNER, `allotmentPct` 80); kế toán được cấp thêm CS-01 qua `PUT /users/{id}/access`. Số tiền OTA luôn lấy từ `POST /quotes/multi-channel` (engine giá máy chủ).

```sh
source lead-env.sh            # DATABASE_MIGRATION_URL, DATABASE_URL
pnpm db:dev-roles
export REDIS_URL=redis://127.0.0.1:6379/10
node tests/e2e/f6-qa/qa-f6-chan.mjs   # 08/11 22:07:04Z → 22:10:43Z (09/11 05:07–05:10 VN), exit 1
node tests/e2e/f6-qa/qa-f6-over.mjs   # 587299c: 22:34:07Z → 22:39:08Z (05:34–05:39 VN), exit 1
node tests/e2e/f6-qa/qa-f6-web.mjs    # 22:16:20Z → 22:17:02Z (05:16–05:17 VN), exit 1
```

Kết quả máy đọc được ghi ở `tests/e2e/f6-qa/results/{chan,over,web}.json` (không commit; mỗi tệp tự kiểm không chứa JWT/PIN/mật khẩu/secret HMAC — `redacted_reproducible_artifacts` PASS ở cả ba). Exit 1 vì có FAIL thật, không phải lỗi hạ tầng.

| Script | PASS | FAIL | BLOCKED | NOT_RUN | FINDING |
| --- | ---: | ---: | ---: | ---: | ---: |
| `qa-f6-chan.mjs` | 19 | 1 | 1 | 1 | 4 |
| `qa-f6-over.mjs` | 16 | 4 | 4 | 1 | 7 |
| `qa-f6-web.mjs` | 21 | 1 | 1 | 0 | 1 |

## 2. CHAN — TC-CHAN-01…11

| TC | Trạng thái | Bằng chứng (đúng lượt chạy) |
| --- | --- | --- |
| 01 quota từng kênh | **PASS** · FAIL phụ | DLX 12 phòng ACTIVE (thêm 7 qua `POST /rooms`): `availableCount` OTA_BOOKING/AGODA/AIRBNB = 9, WEB/PHONE/WALKIN = 12; không ép tổng quota ≤ 12. **FAIL** `configured_allotment_pct_applied`: đặt AGODA/DLX `allotmentPct = 50` ⇒ vẫn 9 ở tồn khả dụng và ảnh đẩy OTA (`quota: 9`) — QA-F6-12 |
| 02 outbox ≤ 5 phút | **PASS** · NOT_RUN phụ | Huỷ booking OTA ⇒ bản tin đồng bộ đầu tiên phản ánh đêm 26/12 tới bên nhận sau **38,8 giây** (nhịp quét QA 20 s; mặc định 300 s vẫn ≤ 5 phút). NOT_RUN: khởi động lại relay giữa lượt (bằng chứng mất/nhân đôi thuộc test khoá HB-130) |
| 03 OTA vượt tồn vẫn `CONFIRMED` | **PASS** | FAM 3 phòng, `overbookLimitPct = 0`: booking thứ 4 `CONFIRMED`, `oversold = true`, payment `OTA_COLLECT` SUCCEEDED, mở 1 ca |
| 04 đóng/mở bán tự động | **PASS** | SUP 6 phòng, 4 booking ⇒ còn 2: OTA cả ba = 0, WEB = 2; huỷ 1 ⇒ OTA mở lại (3/3/1 theo quota), WEB = 3. Đóng thủ công MANAGER giữ đóng sau lượt sync (`manual_closed`, không `auto_closed`) |
| 05 DEGRADED sau 3 lỗi | **PASS** | Bên nhận trả 500 cho AGODA: 3 lệnh sync 202 → FAILED; `DEGRADED`, `consecutiveFailures = 3`, `lastError = E_CHAN_SYNC_FAILED` (không lộ bí mật); BOOKING/AIRBNB giữ OK; 1 thông báo `alert-channel-degraded` cho MANAGER + 1 audit `ALERT_RAISED`; sync kế tiếp SUCCEEDED ⇒ OK/0 |
| 06 thuộc tính 10.000 | **BLOCKED** | Test khoá HB-131 không có lượt thuộc tính (QA-F6-03); phần ví dụ đã chạy thật ở 01/10 |
| 07 OTA huỷ không hoàn | **PASS** | Agoda huỷ < 24h: `CANCELLED`, `cancelReason = OTA_CANCELLATION`, `channelPolicyCode = OTA-CP-FLEX7`, 0 `refund_requests`, phạt 0 |
| 08 chữ ký sai | **PASS** | 401 `E_CHAN_SIGNATURE_INVALID`, 0 hàng inbox, 0 booking; chữ ký đúng nhưng `t` cũ 30 phút ⇒ 401; thân lỗi không chứa chữ ký/secret |
| 09 phát lại 5 lần | **PASS** | 5 lần cùng event ID/raw body, `t` mới ⇒ 200 ×5; đúng 1 booking, 1 hàng inbox; `paid_amount` 1.788.000 và 1 assignment không đổi |
| 10 quota chủ động + cam kết OTA | **PASS** | FAM: tồn công bố OTA trước = 2 (≤ quota); 5 cam kết đã thu tiền đều `CONFIRMED`; chỉ 2 booking vượt cung vật lý `oversold`, 1 ca thiếu 2 |
| 11 20 booking ≤ 5 phút | **PASS** · FINDING | 20 sự kiện ba kênh: 20 × 202, 20 PROCESSED trong **2,2 giây**; đúng 1 booking vượt tồn (`C11-12`), 1 ca thiếu 1. Simulator HB-128 thật `twenty-events`: 20 × accepted, nhưng cả 20 vào DEAD_LETTER `OTA_PROPERTY_UNMAPPED` — QA-F6-01 |

Bổ sung AC3 (một phần): ma trận quyền 10 tổ hợp trên tuyến F6 không cần ID — HOUSEKEEPING/FRONT_DESK không đọc sync-status, ACCOUNTANT không sync, MANAGER không sửa mapping (OWNER), FRONT_DESK không đọc ca (chỉ alert), SYSADMIN không có quyền F6, MANAGER ngoài scope CS-03 ⇒ 403; MANAGER đọc ca và FRONT_DESK đọc alert ⇒ 200 — **PASS**.

## 3. OVER — TC-OVER-01…18

| TC | Trạng thái | Bằng chứng |
| --- | --- | --- |
| 01 gộp ca | **PASS** · FAIL phụ | FAM 2 đêm, 6 booking vượt tồn ⇒ đúng 2 ca `OPEN`, mỗi ca thiếu 3; một lượt quét thật sau đó (`lastSuccessAt` đổi) không nhân ca. **FAIL** `scan_meta_matches_contract` — QA-F6-07 |
| 02 quá T−24h leo thang | **PASS** · FAIL phụ | SUP thiếu 1 ngày 03/12, hạn 02/12 14:00 VN; đẩy đồng hồ 02/12 15:00 ⇒ lượt quét đặt `ESCALATED`, `overdue = true`, `overdueCount = 1`. **FAIL** `case_detail_matches_contract` — QA-F6-08 |
| 03 trần bán vượt | **PASS** (engine) | `packages/domain` `planner-properties.spec.ts::active_oversell_10000` (trần đúng theo cơ sở, mọi đêm) chạy xanh trên commit; chưa thử booking chủ động vượt trần qua HTTP |
| 04 ca cùng transaction | **PASS** | 6/6 booking vượt tồn: ngay khi inbox PROCESSED ca đã tồn tại và `detected_at ≤ created_at` của booking |
| 05 thang 1→2→4 | **PASS** | Ca STD thiếu 2: bậc 1 false ("Không còn phòng cùng loại…"), bậc 2 true, bậc 3 false (160–300 km), bậc 4 true; `assignmentsChanged = false`. Biến thể 12 km: `planner.spec.ts::HB122_geo_boundary_and_explicit_exception` xanh |
| 06 khác cơ sở | **PASS** | Dữ liệu thật: mọi bậc `*_CROSS_PROPERTY` `feasible = false` kèm lý do |
| 07 walk-out | **PASS** nghiệp vụ · **FAIL** hợp đồng · BLOCKED phụ | Bồi thường máy chủ đề xuất = giá đêm đầu 975.000; lễ tân execute trước duyệt ⇒ 409 `E_OVER_APPROVAL_REQUIRED`; MANAGER duyệt (PIN) ⇒ lễ tân execute (PIN) ⇒ `EXECUTED`, có biên bản/chữ ký, `approved_by`; kế toán chi 201, payment `COMPENSATION` CASH 975.000. **FAIL**: body đúng hợp đồng (`walkOut` lồng) bị bỏ chứng từ — QA-F6-06 (luồng trên phải dùng trường phẳng). BLOCKED: hoàn 100% số đã trả (TD-77) |
| 08 nâng hạng giữ giá | **FAIL** | `EXECUTED`, `priceLocked`, tổng 975.000 không đổi, phòng đích đúng, audit PROPOSED/EXECUTED; **không có thông báo khách sau 120 giây** — QA-F6-10. Đi thẳng PROPOSED → EXECUTED — QA-F6-04 |
| 09 khách đang ở | **NOT_RUN** (lượt QA) · PASS ở test khoá | Lượt QA chưa dựng booking CHECKED_IN qua check-in thật. Ca này đã có test tích hợp khoá chạy trên app + CSDL thật: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_09_force_majeure_approval_and_free_move`. Chạy lại 09/11/2026 trên 9d677bc: PASS. Nội dung: lý do thường ⇒ 409 `E_OVER_MOVE_NOT_ALLOWED`; bất khả kháng thiếu MANAGER duyệt ⇒ `E_OVER_APPROVAL_REQUIRED`; có duyệt ⇒ 201 |
| 10 bảng điểm | **PASS** | `relocation-plan` trả 10 ứng viên đủ rank/điểm/nhóm/createdAt/seq theo thứ tự; domain `TC_OVER_10_deterministic_10000` và cả thư mục `test/overbooking` 57/57 xanh |
| 11 consent hai bên | **BLOCKED** | Theo ticket: chưa sửa DDL |
| 12 phòng thông nhau | **BLOCKED** | F6-D01 chờ chốt mô hình |
| 13 mã lỗi ghép | **PASS** | DOR, khách FEMALE/MALE tạo tại quầy: thiếu 1 consent ⇒ `E_OVER_NO_CONSENT`; đủ consent chưa duyệt ⇒ `E_OVER_MERGE_GENDER`; MANAGER duyệt (PIN) ⇒ `ACTIVE`; UNSPECIFIED + FEMALE đủ consent ⇒ `E_OVER_MERGE_GENDER` |
| 14 doanh thu giữ nguyên | **PASS** · FINDING | Doanh thu = tổng gộp `price_snapshots` ORIGINAL (định nghĩa của test khoá HB-124): 313.000/313.000 giữ nguyên; `discountPct` 20, `discountAmount` 125.200 ghi ở merge. Nghĩa vụ phải thu `total_amount` giảm 313.000 → 250.000 mỗi bên (floor 1.000) trong khi `paid_amount` vẫn 313.000, `balance_due` 0, không hồ sơ hoàn — QA-F6-13 |
| 15 Android ≤ 30 giây | **BLOCKED** | Không thiết bị/emulator/Maestro (TD-78) |
| 16 thiếu 2: nâng hạng + walk-out | **PASS** | Hai khách rank 1, 2 của máy chủ: 1 nâng hạng + 1 walk-out ⇒ ca `RESOLVED` 01/12, trước hạn 17/12 |
| 17 qua ngày vẫn ESCALATED | **PASS** | Đẩy đồng hồ 04/12 10:00, chờ > 1 nhịp quét: vẫn `ESCALATED`, `detected_at`/`escalated_at` giữ nguyên, `resolved_at` null |
| 18 execute cũ giữ nguồn | **PASS** | Đề xuất nâng hạng vào phòng X, phòng X bị lấy trước ⇒ execute 409 `E_INV_ROOM_TAKEN`, assignment nguồn không đổi, ca chưa `RESOLVED` |

## 4. Phát hiện (đã đối chiếu mã)

| ID | Mức | Nội dung | Xử lý |
| --- | --- | --- | --- |
| QA-F6-07 | P1 | `GET /overbooking-cases` `meta.scan` = `{status, lastSuccessAt, dataAsOf}` (khoá HB-126) ≠ hợp đồng `{scanStatus, lastSuccessfulScanAt, …}`; thiếu `escalatedAt`/`version`. BFF decode hỏng ⇒ **SCR-43 nhận 502 trên Chromium** (`qa-f6-web`) | HB-220 (#269): chạy lại `qa-f6-web` trên nhánh đó ⇒ SCR-40…47 7/7 PASS |
| QA-F6-08 | P1 | Chi tiết ca thiếu `history`; ứng viên khác `relocationCandidateSchema` (`keepScore` số, thiếu rank/tên che/kỳ ở/tiền) | HB-220 (#269) |
| QA-F6-06 | P1 | Walk-out: hợp đồng + SCR-44 gửi `walkOut: {…}` lồng, server chỉ đọc trường phẳng (test khoá HB-124) ⇒ chứng từ bị bỏ, execute luôn 409 | HB-222 (#270) |
| QA-F6-13 | P2 (tiền) | Sau ghép `MERGE_SHARE` nghĩa vụ phải thu giảm nhưng khách đã trả đủ giá cũ: trả thừa 63.000/booking không có hồ sơ hoàn/đối soát (`balance_due` 0); mức giảm thực 126.000 lệch `discountAmount` 125.200 do làm tròn floor 1.000. Doanh thu snapshot đúng BR-OVER-15 | cần chốt đường hoàn chiết khấu (OTA_COLLECT vs thu trực tiếp) |
| QA-F6-10 | P1 | BR-OVER-10: RoomMove không sinh thông báo khách (chỉ outbox `InventoryChanged`) | HB-223 (#271) |
| QA-F6-12 | P2 | `allotmentPct` của mapping không ảnh hưởng tồn công bố (engine + ảnh worker cứng 80%) | HB-224 (#273) |
| QA-F6-05 | P2 | `room_moves` không lưu `overbookingCaseId`/`consent` (nhận rồi trả `null`) | TD-80 (#274), cần DDL, làm sau #270 |
| QA-F6-03 | P2 | HB-131 AC4 hứa test thuộc tính 10.000, test khoá không có | HB-226 (#274): thuộc tính 10.000 cấu hình, seed cố định, trên engine tồn |
| QA-F6-01 | P3 | Simulator HB-128 cứng cơ sở `H029-A`/ngày/số tiền ngẫu nhiên ⇒ không tạo booking trên dữ liệu thật | HB-227 (#275) |
| QA-F6-02 | P3 | `sales-closure` nhận `from = to` (khoảng rỗng) và trả 200 không làm gì | **Không sửa, đúng hợp đồng**: `salesClosureRequestSchema` chốt "`to` không trước `from`", nên khoảng rỗng là lệnh no-op idempotent |
| QA-F6-04 | ghi chú | Nâng hạng không chi phí không qua APPROVED; khớp F6-D04, kế hoạch kiểm thử TC-OVER-08 chưa cập nhật | tài liệu |
| QA-F6-11 | — | Tổng hợp: 1/7 màn F6 lỗi trên API thật (SCR-43) | theo QA-F6-07 |

## 5. Tiêu chí nghiệm thu HB-194

| AC | Trạng thái |
| --- | --- |
| 1 ma trận 100% TC | Đủ 29 TC ở §2–3, mỗi TC có trạng thái/lý do/chủ xử lý |
| 2 Chromium/WebKit trên API thật | Chromium: SCR-40, 41, 42, 44, 45/46, 47 mở sạch (0 lệnh lỗi, axe 0 serious/critical, không cuộn ngang 360 px); **SCR-43 FAIL** (502). WebKit **BLOCKED**: `browserType.launch` thất bại trên host (thiếu thư viện; cookie `Secure` trên http — TD-53) |
| 3 quyền | Một phần PASS (§2); đổi scope giữa phiên, idempotency replay theo quyền mới: NOT_RUN |
| 4 retry/version | Một phần: phát lại webhook (TC-CHAN-09), ETag/If-Match thật ở mọi lệnh move/merge/mapping, execute cũ 409 (TC-OVER-18); double-tap/timeout/TTL > 24h: NOT_RUN |
| 5 offline Android | BLOCKED (không thiết bị) |
| 6 a11y | Web: axe + 360 px trên 7 màn F6 (PASS cả SCR-43 dù dữ liệu lỗi); bàn phím/aria-live chưa kiểm riêng; Android/TalkBack BLOCKED |
| 7 Android Hermes/Maestro | BLOCKED (không thiết bị/Maestro) |
| 8 artefact đã che | PASS: ba tệp kết quả tự kiểm không JWT/PIN/mật khẩu/secret; log chỉ giữ traceId/mã lỗi/ID tổng hợp |
| 9 mâu thuẫn nguồn | Ghi ở §4 và BLOCKED TC-OVER-11/12 theo F6-D01/DDL |

## 6. Chạy lại

Ba script độc lập, mỗi lần tạo CSDL riêng; `QA_ONLY=<tên hàm>` chạy một phần (vd. `QA_ONLY=tc05,tc04`). Không cần build web cho CHAN/OVER; `qa-f6-web.mjs` tự build operations-web nếu chưa có `.next/BUILD_ID`. Sau `pnpm run ci` phải chạy `pnpm db:dev-roles` trước (mật khẩu `app_rw` bị xoay — TD-56).
