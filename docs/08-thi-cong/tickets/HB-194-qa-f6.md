---
id: HB-194
title: QA F6 trên Chromium, WebKit và operations Android Maestro
risk: R0
owner: gemini
max_lines: 850
allow:
  - tests/e2e/f6-qa/**
  - tests/maestro/f6/qa/**
  - docs/07-ban-giao/bang-chung-f6-qa.md
---

# HB-194 — QA F6 trên Chromium, WebKit và operations Android Maestro

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Ghi bằng chứng có thể chạy lại cho CHAN/OVER F6 trên API thật, OTA simulator, operations web và operations Android. Chứng minh giao diện hiển thị đúng luật máy chủ và những nhánh thất bại giữ phòng nguồn, không mất/nhân đôi booking hoặc tiền. Phân biệt PASS/FAIL/BLOCKED/NOT_RUN từng ca, không nghiệm thu chỉ bằng ảnh UI/API giả.

## Phụ thuộc

- HB-132…HB-139 có endpoint và màn hình tích hợp; xem yêu cầu môi trường và dữ liệu bên dưới.

## Căn cứ

- [lộ trình F6 §7.8/M7](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out), [mốc M7](../../05-ke-hoach/lo-trinh.md).
- [BR nguồn chân lý](../../02-nghiep-vu/quy-tac-nghiep-vu.md) CHAN/OVER, BR-GEN-08, BR-RBAC; [chuyên đề quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md).
- [kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-01…11, TC-OVER-01…18; [màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-40…47/63/67, §8; [API](../../04-thiet-ke/api.md) §1.6/5.1/6.3.
- Phụ thuộc chính HB-132…139; phụ thuộc khả năng chạy thật HB-120…131, HB-014/015/019/020/022/029, HB-097/099/100, HB-002/005/006/007 (infra/migrate/worker/CI). Fixture và đồng hồ giả qua cơ chế test được backend cấp; QA không sửa engine, SQL, policy/RBAC hoặc endpoint để đạt kỳ vọng.
- Chromium/WebKit cấu hình `tests/e2e/playwright.config.ts`: mặc định chỉ Chromium; `E2E_BROWSERS=chromium,webkit` mới có project `operations-web-webkit`. Repo chưa có runner/thư mục Maestro tại thời điểm soạn; kế hoạch không khẳng định thiết bị, browser binary, app build hoặc dịch vụ đã sẵn sàng.

## Phạm vi và ranh giới dữ liệu

QA sở hữu test hành trình tổng hợp trong `f6-qa/` và Maestro `qa/`, không sửa các test của HB-132…139, test locked/backend hoặc cấu hình shared. Reuse seed/simulator đã được chủ backend cung cấp, không mock chính guard tiền/tồn/quyền cần kiểm. Test riêng rendering/fault-injection bằng API giả được ghi là UI_ONLY, không dùng thay bằng chứng nghiệp vụ thật. Không sửa tài liệu `docs/01`, `docs/02`, backlog/mốc hoặc bất kỳ protected/unlock.

Báo cáo `bang-chung-f6-qa.md` phải ghi commit chính xác, ticket/TC/AC, environment, API/worker/container/build/browser/device versions, fixture IDs tổng hợp, quyền/scope, lệnh, exit code, thời gian VN/UTC, trước/sau, kết quả và đường dẫn artefact đã che. Không token/PIN/password/secret/chữ ký/PII thật/payload thô/URL tệp ký trong video/log/trace; chỉ traceId/mã lỗi và ID fixture. Credential runner cấp qua env, không commit `.env` hoặc hard-code PIN trong Maestro. Lỗi bị che dữ liệu vẫn phải giữ mã lỗi để truy vết.

## Ma trận truy vết TC ↔ test tương lai ↔ bằng chứng

Các tên trong bảng là nghĩa vụ thực thi tương lai. TC thuộc tầng domain/integration/security dùng log/bằng chứng đúng commit từ chủ backend, cùng hành trình thật phù hợp; chỉ hình ảnh không chứng minh nguyên tử/10.000 lượt/timing HMAC.

| TC | Test/kiểm chứng có tên | Bằng chứng cần có |
|---|---|---|
| TC-CHAN-01 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_01_per_channel_quota_projection` | 12 đơn vị ACTIVE, mỗi OTA mặc định 9 do API trả; không dùng kỳ vọng tổng OTA chỉ 9 vì trái BR-CHAN-01 |
| TC-CHAN-02 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_02_outbox_delivery_5m` | thay tồn/giá + outbox commit cùng TX, simulator nhận ≤5 phút, restart relay không mất/nhân đôi; log HB-130 |
| TC-CHAN-03 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_03_confirmed_oversold` | tồn 0/pct0 vẫn CONFIRMED+OTA_COLLECT+oversold/case, response và UI |
| TC-CHAN-04 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_04_server_closure_reopen` | tồn 2→3, OTA đóng/mở lại server, direct không đóng; thêm nhánh đóng thủ công không tự mở |
| TC-CHAN-05 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_05_degraded_retry_operation` | 3 lỗi, DEGRADED/count3/mốc/error an toàn, nút retry, operation202→terminal |
| TC-CHAN-06 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_06_quota_properties_evidence` | log property 10.000 cấu hình/DOR từ HB-131, server projection và used>allotment cam kết OTA |
| TC-CHAN-07 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_07_ota_cancel_no_refund` | OTA_CANCELLATION/policyCode, không RefundRequest; snapshot/audit đã che |
| TC-CHAN-08 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_08_invalid_signature_evidence` | simulator sai HMAC 401, không booking; log HB-128 không lộ signature/secret |
| TC-CHAN-09 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_09_webhook_replay_one_booking` | phát lại 5 lần đúng 1 booking/assignment/tiền, ACK/replay audit từ API/simulator |
| TC-CHAN-10 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_10_active_quota_and_confirmed_exception` | bán chủ động chặn vượt quota; cam kết OTA đã xác nhận vẫn nhập/cảnh báo theo BR-CHAN-08; không dùng TC cũ từ chối 3 cam kết |
| TC-CHAN-11 | `tests/e2e/f6-qa/chan.spec.ts::TC_CHAN_11_twenty_bookings_five_minutes` | simulator 20 booking đa kênh ≤5 phút, đúng oversold/case trên SCR42/43 |
| TC-OVER-01 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_01_two_grouped_cases` | 6 booking/2 ngày đúng 2 case và shortageCount, scan log |
| TC-OVER-02 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_02_deadline_escalation` | clock fixture qua T−24h, ESCALATED/OWNER warning, ca mới sau hạn leo thang ngay |
| TC-OVER-03 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_03_server_limits` | log engine pct0/3/5 và trần cơ sở/chuỗi HB-122, UI E_OVER_LIMIT_EXCEEDED; UI không tính ceil |
| TC-OVER-04 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_04_oversold_case_same_transaction` | audit/DB kiểm chứng của backend và booking/case API, không chỉ đếm DOM |
| TC-OVER-05 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_05_ladder_one_two_four` | plan thật bậc1/bậc2/walkout, bậc3 unavailable; fixture 12km chỉ bằng chứng engine khác dữ liệu vận hành |
| TC-OVER-06 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_06_cross_property_permission` | dữ liệu thật 160–300km không bậc3; fixture12km/ngoại lệ có consent/duyệt/cap theo server |
| TC-OVER-07 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_07_walkout_amount_documents` | paid2.000.000 + đêmđầu1.100.000 server; biên bản/chữ ký/duyệt/PIN, ACCOUNTANT chi; không tính tại UI |
| TC-OVER-08 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_08_price_lock_notification_15m` | PROPOSED/APPROVED/EXECUTED, giá gốc giữ nguyên, audit/outbox/notification ≤15 phút |
| TC-OVER-09 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_09_checked_in_force_majeure` | CHECKED_IN thường chặn, bất khả kháng có duyệt đúng quyền mới thành công |
| TC-OVER-10 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_10_complete_score_table_evidence` | log tất định10.000 HB-122 + bảng đủ thành phần/nhóm ưu tiên/createdAt/seq trước confirm, UI không tính/sắp lại |
| TC-OVER-11 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_11_two_consents_share` | một consent chặn, cả hai cùng giới có hiệu lực theo BR-OVER-14 không ép duyệt mọi ca; chưa sửa DDL → BLOCKED |
| TC-OVER-12 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_12_connecting_contract_gate` | BLOCKED tới lead quyết mô hình connecting và contract/DDL khớp; sau đó chứng minh cặp đối xứng/10% server |
| TC-OVER-13 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_13_consent_gender_codes` | thiếu consent→NO_CONSENT, đủ consent khác giới/UNSPECIFIED chưa duyệt→MERGE_GENDER, đủ duyệt mới thành công |
| TC-OVER-14 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_14_revenue_unchanged` | doanh thu1.800.000 giữ nguyên, discountAmount360.000 riêng từ API/ledger, UI chỉ render |
| TC-OVER-15 | `tests/maestro/f6/qa/move-30s.yaml::TC_OVER_15_two_tiers_30s` | thiết bị thật/API thật, video ≤30 giây/≤6 chạm từng bậc, điểm vào/phiên/PIN/network nêu rõ |
| TC-OVER-16 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_16_upgrade_walkout_resolve` | thiếu2, bảng ưu tiên đủ, 1 upgrade+1 walkout qua các principal đúng quyền, 2 move, RESOLVED server trước hạn |
| TC-OVER-17 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_17_past_date_stays_escalated` | clock qua ngày, ESCALATED giữ mốc/người/lý do, không tự đóng/ẩn trên SCR43/67 |
| TC-OVER-18 | `tests/e2e/f6-qa/over.spec.ts::TC_OVER_18_stale_execute_keeps_source` + `tests/maestro/f6/qa/stale-execute.yaml::TC_OVER_18_mobile_atomic_failure` | rút consent/đổi gender/tồn/version/checked-in giữa preview/execute, nguồn giữ, ca mở, rollback server và UI |

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test/kiểm chứng tương lai)

1. Ma trận trên có 100% TC-CHAN-01…11/TC-OVER-01…18, liên kết mọi AC HB132…139 tới test và bằng chứng; ca chưa chạy có status/lý do/chủ xử lý, không bỏ TC hoặc đổi kỳ vọng BR để xanh. — kiểm chứng: `tests/e2e/f6-qa/evidence.spec.ts::coverage_tc_and_ui_ac`.
2. Chromium và WebKit thực mở SCR40…47 trên API thật; trình duyệt/version/commit, request/result và ảnh/trace đã che đầy đủ; API giả được đánh UI_ONLY riêng. — test: `tests/e2e/f6-qa/surfaces.spec.ts::real_api_chromium_webkit_routes`.
3. MANAGER/OWNER/FRONT_DESK/ACCOUNTANT/HOUSEKEEPING/SYSADMIN và ngoài scope/hết phiên thử tập hành động độc lập: đọc không cấp viết, duyệt không cấp execute/chi, trả dữ liệu tối thiểu và không lộ dữ liệu cached sau đổi scope. — test: `tests/e2e/f6-qa/security.spec.ts::rbac_projection_and_scope_matrix`.
4. Mọi command liên quan version và retry đi đủ double tap/timeout/412/428/409 in progress/TTL>24h; cùng key/payload/If-Match retry không nhân đôi, dữ liệu đã đổi phải preview/xác nhận mới, idempotency replay kiểm quyền hiện tại. — test: `tests/e2e/f6-qa/retry.spec.ts::stable_retry_version_and_current_rights`.
5. Loading/empty có mốc quét/error/mạng/unknown result đều phân biệt; offline Android không báo giao phòng/tài chính thành công, online tra lại; nguồn giữ sau conflict. — test: `tests/maestro/f6/qa/offline.yaml::offline_unknown_is_not_success`.
6. Bàn phím/focus/labels/aria-live/contrast và axe serious/critical=0 ở web, 360px không cuộn ngang; Android nhãn/focus/TalkBack/large text có bằng chứng thao tác, không gọi Maestro thay thế chứng minh TalkBack nếu runner không đọc được trạng thái đó. — test: `tests/e2e/f6-qa/a11y.spec.ts::keyboard_axe_mobile_width` + `tests/maestro/f6/qa/a11y.yaml::native_accessibility_evidence`.
7. Operations Android bundle Hermes, build được cài/mở trên máy thật tại M7; Maestro chạy SCR63/67 với fixture/env tổng hợp, ≤30 giây/≤6 chạm tính xác nhận và PIN phát sinh, giá giữ/audit/notification kiểm API; thiếu máy thật/emulator/runner/native build ghi BLOCKED theo khả năng. — test: `tests/maestro/f6/qa/install-smoke.yaml::real_device_install_m7`.
8. Thu thập artefact không lộ PII/PIN/token/secret; fixture/projection/log an toàn và evidence có mã lỗi/traceId. — kiểm chứng: `tests/e2e/f6-qa/evidence.spec.ts::redacted_reproducible_artifacts`.
9. Mâu thuẫn nguồn được ghi rõ trạng thái lead/owner, không sửa protected: scan mỗi giờ BR-OVER05; quota per-channel BR-CHAN01; confirmed OTA miễn trừ BR-CHAN08; mã lỗi BR-OVER14; connecting model và unconditional merge approval chưa chốt ghi BLOCKED. — kiểm chứng: `tests/e2e/f6-qa/evidence.spec.ts::source_conflicts_have_decisions_or_blockers`.

## Chạy và ghi trạng thái khả năng thật

- Web: build apps trước; khởi động API/worker/PG/Redis/simulator và migrate/seed bằng lệnh được backend công bố. `E2E_API_BASE_URL` trỏ API thật, không cài route mock vào suite nghiệp vụ. `E2E_BROWSERS=chromium,webkit pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=operations-web --project=operations-web-webkit tests/e2e/f6-qa/`. Chạy cả tên project chính xác vì script operations-web:e2e mặc định chỉ Chromium.
- Android: appId `vn.pinehill.operations`, build/EXPO_PUBLIC_API_BASE_URL/variant khớp API QA; runner cấp F6_* fixture IDs và test credentials/PIN bằng env, không in env; `maestro test tests/maestro/f6/qa/` với phiên bản/runner thật ghi trong report. Nếu CLI/runner chưa tồn tại, không bịa log hay đổi sang ảnh simulator để gọi PASS.
- Mỗi capability có trạng thái: binary browser, app build/Hermes, emulator, máy thật, Maestro, API/worker/simulator/seed/clock, PIN binding, projection và endpoint. Kiểm tra chưa làm ghi NOT_RUN; thử mà thiếu điều kiện ghi BLOCKED với bằng chứng lỗi và người/ticket gỡ; assertion sai ghi FAIL; chỉ chạy thành công đúng commit mới PASS.
- Các ca cần backend property/security/atomicity nhận artefact CI/local thật đúng SHA từ chủ backend. QA không chạy UI rồi nhận thay log đó. Notification/sync timing dùng mốc backend/simulator cùng clock hoặc đồng bộ đồng hồ, không suy từ toast.

## Ngoài phạm vi

Không sửa implementation/locked tests/engine/contract/RBAC để vượt QA; không thay kỳ vọng theo dữ liệu mock; không tự sửa backlog hay ký M7. P0/P1 giao owner sửa, ghi lại hành trình tái kiểm trên commit mới.

## Cổng phải xanh

`pnpm check:scope` · `npm run check` · `pnpm run ci` (gắn SHA) · các lệnh browser/Android thật ở trên. Báo cáo QA có đủ lỗi/bằng chứng BLOCKED, không yêu cầu tạo PASS giả để nộp report. Nghiệm thu HB195 chỉ nhận khi mọi điều kiện M7 cần thiết được chứng minh hoặc có quyết định lead minh thị cho chuyển pha.
