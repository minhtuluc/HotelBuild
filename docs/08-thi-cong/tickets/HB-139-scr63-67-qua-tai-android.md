---
id: HB-139
title: SCR-63 đổi phòng và SCR-67 cảnh báo quá tải trên operations Android
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-android/app/(f6)/**
  - apps/operations-android/src/features/f6-overbooking/**
  - apps/operations-android/test/f6-overbooking/**
  - tests/maestro/f6/hb139/**
---

# HB-139 — SCR-63 đổi phòng và SCR-67 cảnh báo quá tải trên operations Android

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Lễ tân có quyền thực thi đổi phòng bậc 1–2 với preview server, PIN đúng hành động và xác nhận trực tuyến; quản lý/chủ chuỗi xem các ca quá tải trong scope trên SCR-67. Luồng bậc 1–2 đạt ≤30 giây, mục tiêu ≤5 chạm và trần nghiệm thu ≤6 chạm theo nguồn, đo trên thiết bị với API thật.

## Căn cứ

- F6/M7: [lộ trình §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out); [lộ trình M7](../../05-ke-hoach/lo-trinh.md).
- SCR-63/67, [màn hình §5.3/5.5, §8.1/8.3](../../04-thiet-ke/thiet-ke-man-hinh.md); UC-OVER-01/02, [UC §6.9/6.10](../../01-yeu-cau/mo-hinh-use-case.md).
- [BR](../../02-nghiep-vu/quy-tac-nghiep-vu.md) BR-OVER-04/06…12/16, BR-RBAC-02/03/05, BR-GEN-08; [quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md).
- [API](../../04-thiet-ke/api.md) §1.3/1.6, §2.8, §3.9/3.10, §6.3; [kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-OVER-15/18; [NFR](../../01-yeu-cau/yeu-cau-phi-chuc-nang.md) NFR-USE-05.
## Phụ thuộc

- HB-120 (contracts/client), HB-125 (move + preview), HB-126/127 (case/scan), HB-014 (RBAC/projection), HB-015 (PIN), HB-022 (Android auth/session), HB-029 (idempotency bền), HB-135/136 (liên kết web và nội dung plan). Nền F0 §7.2 đã có Expo Router app, UI-native, env/config và client.
- SCR-57 danh sách đến/SCR-62 tra cứu thuộc F7, không phụ thuộc ngược F7 để mở F6: điểm vào F6 dùng SCR-67/booking deep link trong scope. Nếu TC-OVER-15 yêu cầu đúng điểm vào danh sách đến, ghi bằng chứng điểm vào chưa có là BLOCKED hoặc chờ HB-153; không sửa SCR-57/62 ở ticket này.

## Hợp đồng, quyền và phạm vi module

Tuyến mới nằm trong `app/(f6)/`; controller/view-model/client adapter cục bộ trong `src/features/f6-overbooking/`. Reuse `src/api.ts`, Session, storage và NetInfo hiện có, không sửa chúng hoặc `_layout.tsx`, home/menu chung. Liên kết từ shell dùng điểm mở rộng đã được chủ auth/scaffold cung cấp; cần sửa chung phải điều phối lead để không chồng ticket.

MANAGER/OWNER đọc GET `/api/v1/overbooking-cases` và chi tiết/relocation-plan theo scope. FRONT_DESK không tự nhận quyền đọc case vì catalogue SCR-67 liệt kê ACT-02; dùng GET /overbooking-alerts tối thiểu của HB-126, GET /bookings/{bookingId}/relocation-options và GET room-moves/{id} của HB-125 trong scope; bảng case/keepScore toàn bộ vẫn chỉ quản lý, không tự lấy quyền ấy. FRONT_DESK lập/thực thi move, MANAGER/OWNER khác người lập duyệt; quyền đọc, duyệt và thực thi độc lập. ACCOUNTANT chỉ chi hoàn/bồi thường ở workflow riêng.

POST `/api/v1/room-moves`, POST `.../{roomMoveId}/approve`, POST `.../{roomMoveId}/execute` theo contract. MANAGER/OWNER xem bảng keepScore đủ thành phần/nhóm ưu tiên và thứ tự server; FRONT_DESK chỉ xem phương án của booking đang xử lý, không bảng xếp hạng đầy đủ hoặc PII booking khác. Hiển thị thang 1→2→4, bậc 3 không khả dụng (160–300 km), priceLocked, giá/chi phí và ảnh hưởng server. Không dùng engine miền, tự tính giá/điểm/quota/hạn hoặc tự đổi trạng thái/đóng ca. `CHECKED_IN` chỉ theo preview bất khả kháng có duyệt server; không bypass bằng role cao.

Mỗi ý định ghi giữ key UUIDv4, payload và If-Match ổn định qua retry/refresh. Lệnh create không If-Match; thay đổi đã tồn tại lấy ETag. 412/428 tải lại, so sánh và xác nhận ý định mới. Khi timeout chưa biết kết quả, tra roomMoveId/operation trước lệnh mới; hết TTL 24 giờ phải tra chứng từ trước tạo key mới. API kiểm lại consent/version/tồn tại execute; lỗi giữ nguồn/ca mở. Không lưu PIN/pinToken vào SecureStore/AsyncStorage/bản nháp/queue/analytics; access/refresh token do module auth HB-022 quản lý trong secure storage theo API §6.3, không đưa vào AsyncStorage/log/bản nháp; pinToken chỉ trong bộ nhớ và xoá sau sử dụng/rời màn/đăng xuất. Dùng PIN token đã gắn người/hành động/đối tượng/amount từ HB-015, không sửa contract PIN cục bộ.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. SCR-67 hiển thị case theo scope và hạn server, shortageCount, mốc quét/cập nhật; ESCALATED quá ngày vẫn hiện với lý do, không tự đóng hoặc giả 0 ca khi chưa quét/lỗi. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::alerts_successful_scan_and_escalation`.
2. FRONT_DESK dùng projection booking-specific được cấp; truy cập case-only/deep link ngoài scope bị 403/ẩn dữ liệu; MANAGER đọc không được tự execute hoặc chi tiền; đổi cơ sở huỷ request cũ/xoá dữ liệu cũ. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::independent_actions_and_scope`.
3. SCR-63 cho MANAGER/OWNER xem bảng keepScore đầy đủ và plan theo thứ tự server; FRONT_DESK chỉ xem projection phương án booking đang xử lý, không tải/cache bảng xếp hạng đầy đủ hoặc PII booking khác. Bậc 3 ghi không khả dụng với lý do khoảng cách; không tính lại điểm hoặc nhảy bậc khi lỗi tính plan. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::server_plan_complete_score_and_ladder`.
4. Xem ảnh hưởng trước xác nhận có phòng nguồn/đích, priceLocked, giá gốc và mất quyền lợi bằng chữ/màu; CHECKED_IN thường bị chặn, bất khả kháng chỉ được tiếp tục theo quyền/duyệt server. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::impact_and_checked_in_server_guards`.
5. PIN che ký tự, chỉ trong bộ nhớ; không PIN/pinToken trong storage, bundle, log, ảnh hoặc queue; credential phiên chỉ do auth quản lý trong secure storage, không lưu lại ở module F6; khoá PIN/hết phiên hiện thông báo an toàn, dừng command, xoá pinToken. — test: `apps/operations-android/test/f6-overbooking/security.spec.ts::pin_memory_only_and_session_cleanup`.
6. Double tap/timeout/refresh dùng cùng key/payload/If-Match; 412/428/409 in progress xử lý đúng và vượt TTL tra chứng từ; chỉ response EXECUTED mới hiện hoàn tất. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::stable_retry_etag_reconcile`.
7. Mất mạng trước xác nhận hiện cần kết nối, không gửi command hoặc báo giao phòng/chi tiền thành công; mất mạng sau gửi hiện chưa biết kết quả và tra lại khi online, không tự queue action tài chính. — test: `tests/maestro/f6/hb139/offline-unknown-result.yaml::offline_is_not_success`.
8. Đích bị chiếm, đồng thuận/duyệt bị rút hay version đổi lúc execute giữ phòng nguồn và case chưa RESOLVED; tải plan mới có lý do, không nuốt lỗi hay tự execute bậc khác. — test: `tests/maestro/f6/hb139/execute-conflict.yaml::execute_conflict_keeps_source`.
9. Đủ loading/refresh/empty/validation/forbidden/session-expired/server-error/network/offline/unknown-result; retry có kiểm soát, dữ liệu cũ ghi mốc; mất quyền xoá dữ liệu không còn được đọc. — test: `apps/operations-android/test/f6-overbooking/screen.spec.ts::screen_states_and_recovery`.
10. TalkBack đọc nhãn/header/lỗi, focus dialog hợp lý, nội dung phóng lớn không mất nút; touch target theo UI-native, trạng thái có chữ; gọi khách chỉ dùng projection tối thiểu và quyền đã cấp, không log số điện thoại. — test: `tests/maestro/f6/hb139/a11y.yaml::talkback_labels_focus_and_large_text`.
11. Chạy bậc 1 và bậc 2 trên API thật với fixture tổng hợp: từ danh sách/booking đã sẵn sàng tới response EXECUTED ≤30 giây, mục tiêu ≤5 và tối đa ≤6 chạm; đo mốc bắt đầu/kết thúc, tính cả bước xác nhận và thao tác PIN phát sinh, ghi điều kiện phiên/PIN đã mở hay chưa, không loại thời gian mạng để đạt. — test: `tests/maestro/f6/hb139/move-step1-2.yaml::TC_OVER_15_move_step_one_two_30s`.
12. Giá sau đổi đúng giá server trước đổi, phòng đích/RoomMove thực sự đổi, notification có bằng chứng trong ≤15 phút từ backend (không yêu cầu đo notification nằm trong 30 giây); retry không tạo bản ghi thứ hai. — test: `tests/maestro/f6/hb139/move-step1-2.yaml::TC_OVER_18_verified_server_result`.

## Dữ liệu Maestro và bằng chứng

App ID `vn.pinehill.operations`; fixture chỉ tổng hợp, sinh qua seed/API test của backend. Kịch bản nhận biến môi trường `F6_PROPERTY_ID`, `F6_BOOKING_STEP1_ID`, `F6_BOOKING_STEP2_ID`, `F6_CASE_ID`, `F6_SOURCE_ROOM_ID`, `F6_TARGET_ROOM_ID`, `F6_TEST_USERNAME`, `F6_TEST_PASSWORD`, `F6_TEST_PIN`; giá trị credential/PIN do runner/môi trường QA cấp, không hard-code vào YAML, không commit `.env`, không in env. Nếu runner ghi input vào video/log thì che hoặc tạm dừng ghi ở đoạn nhập bí mật; artefact vẫn chứng minh bước PIN mà không lộ giá trị. URL public chỉ là `EXPO_PUBLIC_API_BASE_URL`, variant `EXPO_PUBLIC_APP_VARIANT=preview`; không nhét secrets OTA vào Expo public env.

Lệnh dự kiến: `maestro test tests/maestro/f6/hb139/` sau khi runner đã cấp biến môi trường và cài build tương ứng. Chỉ dùng cú pháp nạp biến đã được phiên bản Maestro thật hỗ trợ; ghi phiên bản và lệnh chính xác đã chạy. Hiện repo chưa có thư mục/runner Maestro, không được tự nhận có sẵn khả năng đo thời gian/thao tác. Bằng chứng HB-194 ghi commit, build/bundle Hermes, APK checksum, Android version/model, log Maestro, video/screenshot đã che, mốc thời gian, số chạm và đối chiếu API trước/sau; thiếu thiết bị/PIN binding/projection/fixture ghi BLOCKED cụ thể.

## Ngoài phạm vi

Ghép/walk-out/duyệt ngoại lệ đầy đủ đi operations web; SCR-63 chỉ điều hướng tới luồng được cấp hoặc giải thích bước quản lý. Không triển khai SCR-57/62, queue offline HB-159, auth/worker/engine/backend, không lưu PIN, không sửa tài liệu protected/test locked.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi có docs · Vitest app · bundle Hermes bằng cấu hình thực của app · Maestro trên emulator/thiết bị · smoke cài/mở app trên máy thật cho M7. Export/bundle không thay được install/smoke máy thật. Chưa có native project/build command phù hợp phải ghi BLOCKED và lệnh/build artefact còn thiếu, không bịa kết quả hoặc thêm dependency ngoài scope để né điều kiện.

## Ghi chú cho người làm

Đây là đặc tả trước triển khai. Tên test là cam kết tương lai, không phải kết quả chạy. Luồng ≤30 giây lấy từ TC-OVER-15 và §7.8; trần chạm §7.8 là ≤6 trong khi thiết kế §5.3 đặt mục tiêu ≤5. Nếu PIN binding hoặc điểm vào thay đổi khiến vượt chỉ tiêu thì ghi bằng chứng, báo lead quyết định; không bỏ PIN/chạm khỏi phép đo. Không dùng dữ liệu khách thật, log chỉ mã lỗi và traceId an toàn.
