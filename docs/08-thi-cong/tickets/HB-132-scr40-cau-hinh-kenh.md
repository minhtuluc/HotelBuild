---
id: HB-132
title: SCR-40 cấu hình kênh bán
risk: R1
owner: deepseek
max_lines: 750
allow:
  - apps/operations-web/src/app/(ops)/channels/configuration/**
  - apps/operations-web/src/features/hb132-scr40-cau-hinh-kenh/**
  - apps/operations-web/test/hb132-scr40-cau-hinh-kenh/**
  - tests/e2e/f6/hb132-scr40-cau-hinh-kenh.spec.ts
---

# HB-132 — SCR-40 cấu hình kênh bán

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Cung cấp SCR-40 cấu hình kênh bán trên operations web bằng các command/projection đã được API kiểm quyền; người dùng thấy rõ kết quả xác nhận và cách phục hồi khi dữ liệu đổi hoặc mất mạng.

## Căn cứ

- Pha F6, mốc M7: [lộ trình thi công §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out).
- Nguồn chân lý: [quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) §8–9, §14; [quá tải, ghép, đổi phòng](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md).
- [UC N4, §6.8–6.11](../../01-yeu-cau/mo-hinh-use-case.md), [FR CHAN/OVER](../../01-yeu-cau/yeu-cau-chuc-nang.md).
- [API](../../04-thiet-ke/api.md) §1.3, §1.6, §2.7–2.8, §3.9–3.10, §6.3–6.4; §6.3 có hiệu lực khi nhãn actor ở catalogue khác tập quyền.
- [màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) catalogue, §4.7, §8.1–8.3; [kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN/TC-OVER.
- Phạm vi truy vết: SCR-40; UC-CHAN-01; FR-CHAN-01/02/08, FR-OVER-01; BR-CHAN-01/05/08, BR-OVER-01/02.
## Phụ thuộc

- HB-120, HB-131, HB-020, HB-014, HB-019. Nền F0 §7.2 đã có shell, UI shared và client; HB-019/020 là phiên/auth, HB-014 là RBAC/projection, HB-029 là idempotency bền; chỉ triển khai khi API/client/projection tương ứng đã chốt.

## Hợp đồng và quyền

OWNER cấu hình kênh và ánh xạ; MANAGER/OWNER chỉ có thao tác quota/đóng bán trong scope được máy chủ cấp. Dùng PUT `/api/v1/channels/{channelId}/mappings`, POST `.../sales-closure` và PATCH `/api/v1/channels/{channelId}` khi hợp đồng HB-120 có; trần theo cơ sở là projection, chỉnh `overbookLimitPct` chỉ qua hợp đồng cấu hình cơ sở đã có. GET `/api/v1/channels` (projection tối thiểu, kiểm scope) và dữ liệu cấu hình/ánh xạ cùng trường đơn vị bán, quota, used, giá thuần/cảnh báo cân bằng giá là yêu cầu projection phải được HB-120 cung cấp; không dùng SQL hoặc dựng API đọc riêng ở frontend.

UI gọi hợp đồng/client HB-120 đã phát hành, không tự đặt DTO hay endpoint. Hiển thị nguyên kết quả máy chủ: số tiền VND nguyên, hạn/thời điểm theo giờ VN, trạng thái, thứ tự ứng viên, trần/quota, lý do chặn và quyền thao tác. Không import engine miền, tính keepScore, tính giá/hoàn/chiết khấu, tự suy quyền theo thứ bậc role hoặc chuyển trạng thái nghiệp vụ cục bộ. Chỉ kiểm hình dạng ô nhập và định dạng hiển thị; mọi luật vẫn do API kiểm.

Mỗi ý định ghi có một `Idempotency-Key` UUIDv4; retry khi timeout/refresh dùng cùng payload, key và `If-Match`. Thay đổi aggregate/cấu hình đã tồn tại lấy ETag mới nhất; create không cần If-Match. `412`/`428` yêu cầu đọc lại, so sánh và xác nhận ý định mới; không tự retry với version mới. `409 E_SYS_REQUEST_IN_PROGRESS` theo Retry-After; mất phản hồi giữ trạng thái chưa biết, tra kết quả trước lệnh mới. Quá TTL 24 giờ tra chứng từ/operation theo ID trước khi tạo key mới; không gửi lại mù. Phiên hết hạn hoặc quyền bị thu hồi phải dừng hành động và xoá dữ liệu đã cache của scope cũ.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. Hiện cấu hình theo cơ sở/kênh/loại/ngày, đơn vị phòng hoặc giường DOR, allotment/used/tồn công bố/trần do API trả; không cộng allotment các OTA thành tồn bị giữ và không tính lại trần. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::server_configuration_projection`.
2. OWNER gửi ánh xạ/mã phòng OTA và bật/tắt hoặc cấu hình theo hợp đồng; phản hồi thành công mới thay dữ liệu, lỗi validation gắn trường; quota/đóng bán của MANAGER chỉ khi quyền cụ thể cho phép. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::mapping_and_scoped_commands`.
3. API trả E_OVER_LIMIT_EXCEEDED thì giữ bản nhập và hiện thông điệp vượt trần theo cơ sở; 0%/5% và DOR hiển thị từ fixture API, frontend không tính ceil/floor hay dùng hằng giá. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::overbook_limit_error`.
4. Đóng thủ công, đóng tự động do tồn thấp và trạng thái mở lại hiển thị riêng theo response; không mở lại cục bộ hay từ chối cam kết OTA dựa trên used > allotment. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::server_sales_closure_states`.
5. Các cảnh báo giá thuần OTA thấp hơn WEB do API cấp được hiện trước xác nhận, không tính hoa hồng/giá thuần tại UI. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::server_rate_warning`.
6. Mọi request và liên kết dùng scope phiên hiện tại; đổi cơ sở huỷ request cũ/xoá dữ liệu cũ; 401 hết phiên và 403 từ chối khác nhau, không coi OWNER/MANAGER là kế thừa mọi quyền. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::current_scope_permission_fail_closed`.
7. Mọi command cập nhật ETag/If-Match và key ổn định như §Hợp đồng; 412/428/409 request in progress/timeout/hết TTL xử lý theo từng nhánh, không tạo side effect mới để làm hết lỗi. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::etag_stable_retry_reconcile`.
8. Đủ loading, refreshing giữ dữ liệu cũ, empty có điều kiện, validation error, forbidden, expired session, server error, network/offline và unknown result; thử lại có kiểm soát, không biến lỗi thành danh sách rỗng/thành công. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::screen_states_network_failure`.
9. Chromium và WebKit mở tuyến thật, thao tác bằng bàn phím, focus trả về đúng sau dialog, label/error/aria-live đầy đủ; axe không có serious/critical, trạng thái có chữ, viewport 360 px không cuộn ngang. — test: `tests/e2e/f6/hb132-scr40-cau-hinh-kenh.spec.ts::browser_keyboard_a11y_responsive`.
10. Log/ảnh/trace không chứa PII/bí mật/PIN/token hoặc payload thô; dữ liệu tổng hợp và trường tối thiểu, mã lỗi và traceId an toàn giúp truy vết. — test: `apps/operations-web/test/hb132-scr40-cau-hinh-kenh/screen.spec.ts::redacted_evidence_and_logs`.

## Ngoài phạm vi

Engine/domain, migration, worker/webhook/outbox, luật giá/tồn/consent/phân quyền, contract/client và auth lõi thuộc các phụ thuộc. Không sửa tài liệu protected hoặc test locked.

## Cổng phải xanh và bằng chứng thực chạy

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi PR thêm tài liệu · `pnpm test:e2e`. Chạy cả hai project: `E2E_BROWSERS=chromium,webkit pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=operations-web --project=operations-web-webkit tests/e2e/f6/hb132-scr40-cau-hinh-kenh.spec.ts` sau khi build web. Mở màn hình thật trên API thật trong QA HB-194; ghi commit, browser/version, fixture/scope, lệnh, exit code, trace/screenshot đã che. Thiếu binary/API/phụ thuộc ghi BLOCKED cụ thể, không gọi browser mock là nghiệm thu backend.

## Ghi chú cho người làm

- Các đường dẫn `allow` là module riêng của ticket; chỉ các tuyến này và test tương ứng được sở hữu. Không sửa layout, menu, session, i18n chung, client hay contracts trong ticket UI; nhu cầu tích hợp dùng điểm mở rộng từ phụ thuộc hoặc báo lead điều phối thay đổi không chồng ticket.
- Mã hiện tại chỉ có shell `(ops)`, trạng thái mẫu và khung auth Android; chưa có module F6. Đường dẫn dưới đây là dự kiến tạo mới, phải khớp hợp đồng HB-120. Thiếu projection thì ghi BLOCKED cho phần đó và chuyển HB-120/chủ endpoint bổ sung, không giả dữ liệu trong chạy nghiệm thu.
- Không ghi token, PIN, cookie, chữ ký webhook, secret OTA, URL tệp ký, dữ liệu khách thật hoặc PII vào console/analytics/ảnh bằng chứng. Fixture dùng dữ liệu tổng hợp, log chỉ traceId đã che và mã lỗi an toàn.
- Unit/API giả chỉ chứng minh UI; nghiệm thu nghiệp vụ cần API thật, seed, simulator và bằng chứng HB-194. Tên test dưới đây là nghĩa vụ tương lai, chưa có kết quả chạy trong bản đặc tả.
