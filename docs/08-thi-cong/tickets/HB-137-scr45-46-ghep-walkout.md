---
id: HB-137
title: SCR-45 ghép phòng và SCR-46 walk-out
risk: R1
owner: deepseek
max_lines: 750
allow:
  - apps/operations-web/src/app/(ops)/overbooking/merge-walkout/**
  - apps/operations-web/src/features/hb137-scr45-46-ghep-walkout/**
  - apps/operations-web/test/hb137-scr45-46-ghep-walkout/**
  - tests/e2e/f6/hb137-scr45-46-ghep-walkout.spec.ts
---

# HB-137 — SCR-45 ghép phòng và SCR-46 walk-out

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Cung cấp SCR-45 ghép phòng và SCR-46 walk-out trên operations web bằng các command/projection đã được API kiểm quyền; người dùng thấy rõ kết quả xác nhận và cách phục hồi khi dữ liệu đổi hoặc mất mạng.

## Căn cứ

- Pha F6, mốc M7: [lộ trình thi công §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out).
- Nguồn chân lý: [quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) §8–9, §14; [quá tải, ghép, đổi phòng](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md).
- [UC N4, §6.8–6.11](../../01-yeu-cau/mo-hinh-use-case.md), [FR CHAN/OVER](../../01-yeu-cau/yeu-cau-chuc-nang.md).
- [API](../../04-thiet-ke/api.md) §1.3, §1.6, §2.7–2.8, §3.9–3.10, §6.3–6.4; §6.3 có hiệu lực khi nhãn actor ở catalogue khác tập quyền.
- [màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) catalogue, §4.7, §8.1–8.3; [kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN/TC-OVER.
- Phạm vi truy vết: SCR-45/46; UC-OVER-03/04; FR-OVER-08/13/14/15; BR-OVER-06/08/13/14/15, BR-CANCEL-14; TC-OVER-07/11/12/13/14/18.
## Phụ thuộc

- HB-120, HB-125, HB-135, HB-136, HB-014, HB-015, HB-020, HB-029, HB-097, HB-099, HB-100, HB-019. Nền F0 §7.2 đã có shell, UI shared và client; HB-019/020 là phiên/auth, HB-014 là RBAC/projection, HB-029 là idempotency bền; chỉ triển khai khi API/client/projection tương ứng đã chốt.

## Hợp đồng và quyền

Dùng POST `/api/v1/room-merges`, `.../{roomMergeId}/consent`, `.../approve`, `.../execute` và RoomMove WALK_OUT của HB-125. FRONT_DESK lập/ghi consent/thực thi; MANAGER/OWNER khác người lập duyệt; ACCOUNTANT chi hoàn qua HB-099/HB-100; chi bồi thường qua compensation-payments của HB-125 đã duyệt với PIN và operation riêng, không coi quyền duyệt là quyền chi. Projection trả quyền, loại ghép, sức chứa/đơn vị bán, hai cờ consent và bằng chứng được kiểm scope, giới tính tối thiểu cần nghiệp vụ, discountPct/discountAmount/doanh thu snapshot, hồ sơ walk-out và trạng thái thanh toán. evidenceUrl trong bảng API chỉ dùng theo hợp đồng tệp private đã chốt (ID tệp/URL ký), không nhập URL internet tuỳ ý.

UI gọi hợp đồng/client HB-120 đã phát hành, không tự đặt DTO hay endpoint. Hiển thị nguyên kết quả máy chủ: số tiền VND nguyên, hạn/thời điểm theo giờ VN, trạng thái, thứ tự ứng viên, trần/quota, lý do chặn và quyền thao tác. Không import engine miền, tính keepScore, tính giá/hoàn/chiết khấu, tự suy quyền theo thứ bậc role hoặc chuyển trạng thái nghiệp vụ cục bộ. Chỉ kiểm hình dạng ô nhập và định dạng hiển thị; mọi luật vẫn do API kiểm.

Mỗi ý định ghi có một `Idempotency-Key` UUIDv4; retry khi timeout/refresh dùng cùng payload, key và `If-Match`. Thay đổi aggregate/cấu hình đã tồn tại lấy ETag mới nhất; create không cần If-Match. `412`/`428` yêu cầu đọc lại, so sánh và xác nhận ý định mới; không tự retry với version mới. `409 E_SYS_REQUEST_IN_PROGRESS` theo Retry-After; mất phản hồi giữ trạng thái chưa biết, tra kết quả trước lệnh mới. Quá TTL 24 giờ tra chứng từ/operation theo ID trước khi tạo key mới; không gửi lại mù. Phiên hết hạn hoặc quyền bị thu hồi phải dừng hành động và xoá dữ liệu đã cache của scope cũ.

### Điều kiện mở nhánh ghép

MERGE_CONNECTING đang BLOCKED cho tới khi lead quyết định cách biểu diễn một booking/phòng ghép hay hai booking độc lập: tài liệu nghiệp vụ chuyên đề và DDL chưa thống nhất. Không tự chọn mô hình ở frontend. MERGE_SHARE cùng giới, đủ đồng thuận không buộc duyệt theo BR-OVER-14; DDL đang buộc duyệt mọi ghép nên HB-121/HB-124/HB-125 phải sửa guard/schema theo BR trước chạy thật. UI dùng trạng thái/quyền server đã đúng BR, không dựng phê duyệt giả.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. SCR45 hiện MERGE_SHARE cho phòng/giường server cho phép, MERGE_CONNECTING chỉ sau quyết định lead và hợp đồng/DDL đã khớp, theo cặp đối xứng server xác nhận và SPLIT_ROOMS nếu hợp đồng có; giá gốc/doanh thu giữ nguyên, chiết khấu 20%/10% và discountAmount chỉ lấy response. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::merge_projection_preserves_revenue`.
2. Hai bên xác nhận độc lập với bằng chứng hợp lệ trên hệ thống; thiếu một bên E_OVER_NO_CONSENT; cùng giới đủ consent không ép bước duyệt; đủ consent nhưng khác giới/UNSPECIFIED chưa duyệt E_OVER_MERGE_GENDER, không dùng mã cũ TCOVER13. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::consent_gender_distinct_errors`.
3. Thực thi ghép kiểm lại version/consent/tồn/trạng thái cả hai booking tại máy chủ; mất một điều kiện thì giữ cả hai nguồn và ca mở, không đổi ACTIVE cục bộ. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::merge_execute_atomic_failure_projection`.
4. SCR46 xem preview WALK_OUT có cơ sở hoàn, gross/net/phí và bồi thường một đêm đầu/đưa đón do server tính; nhánh tiền lẻ/phí chỉ mở sau lead chốt tại HB-123, không tự hứa net=paid; cần consent/duyệt và walkOutDocNo/guestSignatureRef/staffSignatureRef trước execute theo hợp đồng. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::walkout_documents_and_server_amounts`.
5. Lập walk-out/duyệt/thực thi/chi tiền là các bước có quyền riêng; hiện chờ duyệt/chờ chi/đã thực thi theo server, không báo tiền đã chi vì RoomMove được duyệt và không mở payout mới từ timeout. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::walkout_payment_permission_separation`.
6. Thu hồi đồng thuận, cặp phòng sai, sức chứa sai hay booking chuyển trạng thái giữa preview/execute hiển thị mã lỗi an toàn và tải lại, không nuốt lỗi hoặc chuyển thành ghép thành công. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::merge_stale_preview_recovery`.
7. Mọi request và liên kết dùng scope phiên hiện tại; đổi cơ sở huỷ request cũ/xoá dữ liệu cũ; 401 hết phiên và 403 từ chối khác nhau, không coi OWNER/MANAGER là kế thừa mọi quyền. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::current_scope_permission_fail_closed`.
8. Mọi command cập nhật ETag/If-Match và key ổn định như §Hợp đồng; 412/428/409 request in progress/timeout/hết TTL xử lý theo từng nhánh, không tạo side effect mới để làm hết lỗi. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::etag_stable_retry_reconcile`.
9. Đủ loading, refreshing giữ dữ liệu cũ, empty có điều kiện, validation error, forbidden, expired session, server error, network/offline và unknown result; thử lại có kiểm soát, không biến lỗi thành danh sách rỗng/thành công. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::screen_states_network_failure`.
10. Chromium và WebKit mở tuyến thật, thao tác bằng bàn phím, focus trả về đúng sau dialog, label/error/aria-live đầy đủ; axe không có serious/critical, trạng thái có chữ, viewport 360 px không cuộn ngang. — test: `tests/e2e/f6/hb137-scr45-46-ghep-walkout.spec.ts::browser_keyboard_a11y_responsive`.
11. Log/ảnh/trace không chứa PII/bí mật/PIN/token hoặc payload thô; dữ liệu tổng hợp và trường tối thiểu, mã lỗi và traceId an toàn giúp truy vết. — test: `apps/operations-web/test/hb137-scr45-46-ghep-walkout/screen.spec.ts::redacted_evidence_and_logs`.

## Ngoài phạm vi

Engine/domain, migration, worker/webhook/outbox, luật giá/tồn/consent/phân quyền, contract/client và auth lõi thuộc các phụ thuộc. Không sửa tài liệu protected hoặc test locked.

## Cổng phải xanh và bằng chứng thực chạy

`pnpm check:scope` · `pnpm run ci` · `npm run check` khi PR thêm tài liệu · `pnpm test:e2e`. Chạy cả hai project: `E2E_BROWSERS=chromium,webkit pnpm exec playwright test -c tests/e2e/playwright.config.ts --project=operations-web --project=operations-web-webkit tests/e2e/f6/hb137-scr45-46-ghep-walkout.spec.ts` sau khi build web. Mở màn hình thật trên API thật trong QA HB-194; ghi commit, browser/version, fixture/scope, lệnh, exit code, trace/screenshot đã che. Thiếu binary/API/phụ thuộc ghi BLOCKED cụ thể, không gọi browser mock là nghiệm thu backend.

## Ghi chú cho người làm

- Các đường dẫn `allow` là module riêng của ticket; chỉ các tuyến này và test tương ứng được sở hữu. Không sửa layout, menu, session, i18n chung, client hay contracts trong ticket UI; nhu cầu tích hợp dùng điểm mở rộng từ phụ thuộc hoặc báo lead điều phối thay đổi không chồng ticket.
- Mã hiện tại chỉ có shell `(ops)`, trạng thái mẫu và khung auth Android; chưa có module F6. Đường dẫn dưới đây là dự kiến tạo mới, phải khớp hợp đồng HB-120. Thiếu projection thì ghi BLOCKED cho phần đó và chuyển HB-120/chủ endpoint bổ sung, không giả dữ liệu trong chạy nghiệm thu.
- Không ghi token, PIN, cookie, chữ ký webhook, secret OTA, URL tệp ký, dữ liệu khách thật hoặc PII vào console/analytics/ảnh bằng chứng. Fixture dùng dữ liệu tổng hợp, log chỉ traceId đã che và mã lỗi an toàn.
- Unit/API giả chỉ chứng minh UI; nghiệm thu nghiệp vụ cần API thật, seed, simulator và bằng chứng HB-194. Tên test dưới đây là nghĩa vụ tương lai, chưa có kết quả chạy trong bản đặc tả.
