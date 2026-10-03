---
id: HB-136
title: SCR-44 đề xuất và thực hiện điều chuyển
risk: R1
owner: deepseek
max_lines: 750
allow:
  - apps/operations-web/src/app/(ops)/overbooking/relocation/**
  - apps/operations-web/src/features/hb136-scr44-dieu-chuyen/**
  - apps/operations-web/test/hb136-scr44-dieu-chuyen/**
  - tests/e2e/f6/hb136-scr44-dieu-chuyen.spec.ts
---

# HB-136 — SCR-44 đề xuất và thực hiện điều chuyển

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Cung cấp SCR-44 đề xuất và thực hiện điều chuyển trên operations web bằng các command/projection đã được API kiểm quyền; người dùng thấy rõ kết quả xác nhận và cách phục hồi khi dữ liệu đổi hoặc mất mạng.

## Căn cứ

- Pha F6, mốc M7: [lộ trình thi công §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out).
- Nguồn chân lý: [quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) §8–9, §14; [quá tải, ghép, đổi phòng](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md).
- [UC N4, §6.8–6.11](../../01-yeu-cau/mo-hinh-use-case.md), [FR CHAN/OVER](../../01-yeu-cau/yeu-cau-chuc-nang.md).
- [API](../../04-thiet-ke/api.md) §1.3, §1.6, §2.7–2.8, §3.9–3.10, §6.3–6.4; §6.3 có hiệu lực khi nhãn actor ở catalogue khác tập quyền.
- [màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) catalogue, §4.7, §8.1–8.3; [kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN/TC-OVER.
- Phạm vi truy vết: SCR-44; UC-OVER-02; FR-OVER-05/06/07/09/10/11/12; BR-OVER-06…12; TC-OVER-05/06/08/09/10/16/18.
## Phụ thuộc

- HB-120, HB-125, HB-135, HB-014, HB-015, HB-020, HB-029, HB-019. Nền F0 §7.2 đã có shell, UI shared và client; HB-019/020 là phiên/auth, HB-014 là RBAC/projection, HB-029 là idempotency bền; chỉ triển khai khi API/client/projection tương ứng đã chốt.

## Hợp đồng và quyền

GET chi tiết case/candidates và POST `/api/v1/overbooking-cases/{caseId}/relocation-plan` cho MANAGER/OWNER; POST `/api/v1/room-moves` và `.../{roomMoveId}/execute` chỉ FRONT_DESK; `.../approve` chỉ MANAGER/OWNER khác người lập. Đọc plan không cấp quyền execute; quản lý phê duyệt rồi lễ tân thực hiện theo workflow. FRONT_DESK dùng GET /bookings/{bookingId}/relocation-options và GET room-moves/{id} do HB-120/HB-125 công bố, không gọi case rank của quản lý. Preview cần bảng phân rã keepScore và nhóm ưu tiên cứng, mất quyền lợi, priceLocked, giá gốc/chi phí/consent/approval, ETag và allowedActions. PIN dùng auth chung, ràng buộc người/hành động/đối tượng/số tiền; không sửa lõi PIN trong ticket này.

UI gọi hợp đồng/client HB-120 đã phát hành, không tự đặt DTO hay endpoint. Hiển thị nguyên kết quả máy chủ: số tiền VND nguyên, hạn/thời điểm theo giờ VN, trạng thái, thứ tự ứng viên, trần/quota, lý do chặn và quyền thao tác. Không import engine miền, tính keepScore, tính giá/hoàn/chiết khấu, tự suy quyền theo thứ bậc role hoặc chuyển trạng thái nghiệp vụ cục bộ. Chỉ kiểm hình dạng ô nhập và định dạng hiển thị; mọi luật vẫn do API kiểm.

Mỗi ý định ghi có một `Idempotency-Key` UUIDv4; retry khi timeout/refresh dùng cùng payload, key và `If-Match`. Thay đổi aggregate/cấu hình đã tồn tại lấy ETag mới nhất; create không cần If-Match. `412`/`428` yêu cầu đọc lại, so sánh và xác nhận ý định mới; không tự retry với version mới. `409 E_SYS_REQUEST_IN_PROGRESS` theo Retry-After; mất phản hồi giữ trạng thái chưa biết, tra kết quả trước lệnh mới. Quá TTL 24 giờ tra chứng từ/operation theo ID trước khi tạo key mới; không gửi lại mù. Phiên hết hạn hoặc quyền bị thu hồi phải dừng hành động và xoá dữ liệu đã cache của scope cũ.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. MANAGER/OWNER xem hoặc in bảng đầy đủ ứng viên trước xác nhận: nhóm ưu tiên cứng BR-OVER12, các thành phần keepScore, tổng điểm, createdAt, Booking.seq và thứ tự máy chủ; không tính/sắp lại, không lược bảng thành top hai. FRONT_DESK chỉ xem projection phương án của booking đang xử lý, không tải, in hoặc cache bảng xếp hạng/PII của booking khác. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::complete_keep_score_table`.
2. Thang chuẩn hiện 1 → 2 → 4, bậc 3 vô hiệu với lý do cơ sở cách 160–300 km; nhánh đặc biệt khác thành phố chỉ khi plan server có consent/duyệt riêng, không giả khả dụng bậc 3. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::server_ladder_unavailable_step_three`.
3. Xem ảnh hưởng hiển thị phòng nguồn/đích, mất ban công/phòng thông nhau/giảm sức chứa bằng cảnh báo chữ và màu, priceLocked và số tiền gốc/chi phí nguyên từ API; không thu chênh lệch nâng hạng. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::impact_price_lock_projection`.
4. Các nút lập/duyệt/execute đúng permission riêng; CHECKED_IN thường bị chặn kèm lý do, bất khả kháng chỉ theo quyết định API có MANAGER/OWNER duyệt và PIN khi yêu cầu. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::checked_in_and_approval_permissions`.
5. Duyệt/execute mang PIN và version chính xác, double tap/timeout không tạo move thứ hai; chỉ response EXECUTED mới hiện hoàn tất, trạng thái notification server phân biệt với đã gửi. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::move_approval_execute_idempotency`.
6. Tồn đích bị lấy, consent/approval bị rút hoặc version đổi ở execute trả E_INV_ROOM_TAKEN/E_OVER_NO_CONSENT/412 tương ứng: giữ hiển thị phòng nguồn và ca còn mở, đọc lại phương án, không tự thử bậc sau. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::execute_conflict_keeps_source`.
7. Mọi request và liên kết dùng scope phiên hiện tại; đổi cơ sở huỷ request cũ/xoá dữ liệu cũ; 401 hết phiên và 403 từ chối khác nhau, không coi OWNER/MANAGER là kế thừa mọi quyền. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::current_scope_permission_fail_closed`.
8. Mọi command cập nhật ETag/If-Match và key ổn định như §Hợp đồng; 412/428/409 request in progress/timeout/hết TTL xử lý theo từng nhánh, không tạo side effect mới để làm hết lỗi. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::etag_stable_retry_reconcile`.
9. Đủ loading, refreshing giữ dữ liệu cũ, empty có điều kiện, validation error, forbidden, expired session, server error, network/offline và unknown result; thử lại có kiểm soát, không biến lỗi thành danh sách rỗng/thành công. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::screen_states_network_failure`.
10. Chromium và WebKit mở tuyến thật, thao tác bằng bàn phím, focus trả về đúng sau dialog, label/error/aria-live đầy đủ; axe không có serious/critical, trạng thái có chữ, viewport 360 px không cuộn ngang. — test: `tests/e2e/f6/hb136-scr44-dieu-chuyen.spec.ts::browser_keyboard_a11y_responsive`.
11. Log/ảnh/trace không chứa PII/bí mật/PIN/token hoặc payload thô; dữ liệu tổng hợp và trường tối thiểu, mã lỗi và traceId an toàn giúp truy vết. — test: `apps/operations-web/test/hb136-scr44-dieu-chuyen/screen.spec.ts::redacted_evidence_and_logs`.

## Ngoài phạm vi

Engine/domain, migration, worker/webhook/outbox, luật giá/tồn/consent/phân quyền, contract/client và auth lõi thuộc các phụ thuộc. Không sửa tài liệu protected hoặc test locked.

## Cổng phải xanh và bằng chứng thực chạy

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi PR thêm tài liệu · `pnpm test:e2e`. Chạy cả hai project: `E2E_BROWSERS=chromium,webkit pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=operations-web --project=operations-web-webkit tests/e2e/f6/hb136-scr44-dieu-chuyen.spec.ts` sau khi build web. Mở màn hình thật trên API thật trong QA HB-194; ghi commit, browser/version, fixture/scope, lệnh, exit code, trace/screenshot đã che. Thiếu binary/API/phụ thuộc ghi BLOCKED cụ thể, không gọi browser mock là nghiệm thu backend.

## Ghi chú cho người làm

- Các đường dẫn `allow` là module riêng của ticket; chỉ các tuyến này và test tương ứng được sở hữu. Không sửa layout, menu, session, i18n chung, client hay contracts trong ticket UI; nhu cầu tích hợp dùng điểm mở rộng từ phụ thuộc hoặc báo lead điều phối thay đổi không chồng ticket.
- Mã hiện tại chỉ có shell `(ops)`, trạng thái mẫu và khung auth Android; chưa có module F6. Đường dẫn dưới đây là dự kiến tạo mới, phải khớp hợp đồng HB-120. Thiếu projection thì ghi BLOCKED cho phần đó và chuyển HB-120/chủ endpoint bổ sung, không giả dữ liệu trong chạy nghiệm thu.
- Không ghi token, PIN, cookie, chữ ký webhook, secret OTA, URL tệp ký, dữ liệu khách thật hoặc PII vào console/analytics/ảnh bằng chứng. Fixture dùng dữ liệu tổng hợp, log chỉ traceId đã che và mã lỗi an toàn.
- Unit/API giả chỉ chứng minh UI; nghiệm thu nghiệp vụ cần API thật, seed, simulator và bằng chứng HB-194. Tên test dưới đây là nghĩa vụ tương lai, chưa có kết quả chạy trong bản đặc tả.
