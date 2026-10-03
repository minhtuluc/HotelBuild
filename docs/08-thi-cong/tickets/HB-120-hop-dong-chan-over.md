---
id: HB-120
title: Hợp đồng F6 — kênh OTA, ca quá tải, điều chuyển và ghép phòng
risk: R2
owner: deepseek
max_lines: 1000
allow:
  - packages/contracts/src/channel.ts
  - packages/contracts/src/overbooking.ts
  - packages/contracts/src/errors.ts
  - packages/contracts/src/enums.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/openapi/paths/f6.ts
  - packages/contracts/src/openapi/registry.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/f6/**
  - packages/api-client/src/channel.ts
  - packages/api-client/src/overbooking.ts
  - packages/api-client/src/index.ts
  - packages/api-client/test/f6/**
  - packages/ui-web/src/messages.ts
  - packages/ui-web/src/errors.ts
  - packages/ui-native/src/stateMessages.ts
  - docs/04-thiet-ke/api.md
---

# HB-120 — Hợp đồng CHAN + OVER

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Công bố schema, OpenAPI và client dùng chung cho F6 trước khi viết backend và màn hình. Hợp đồng chỉ mô tả dữ liệu, không hiện thực luật tồn, tiền, phê duyệt hay xếp hạng ở frontend.

## Phụ thuộc

- HB-011 (nền hợp đồng); HB-090 (hợp đồng thanh toán/hoàn dùng lại cho walk-out).
- Dùng lại hợp đồng kênh của HB-050/HB-055, booking của HB-070 và idempotency/PIN của F1; không đổi tên hoặc ngữ nghĩa trường đã phát hành.
- HB-121…HB-139 dùng hợp đồng này. Mọi bổ sung để phục vụ màn hình phải công bố trước trong ticket này hoặc bổ sung không phá vỡ có test ở ticket sử dụng.

## Căn cứ

- Pha F6/M7: [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md).
- [API](../../04-thiet-ke/api.md) §1, §2.7–2.8, §3.9–3.10, §4.2, §5.1, §6.3–6.4.
- [BR](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-CHAN-01…08, BR-OVER-01…16, BR-RBAC-02…05, BR-GEN-08, BR-CANCEL-14…18.
- [Yêu cầu](../../01-yeu-cau/yeu-cau-chuc-nang.md): FR-CHAN-01…08, FR-OVER-01…17; [use case](../../01-yeu-cau/mo-hinh-use-case.md): UC-CHAN-01…03, UC-OVER-01…05.
- [CSDL](../../04-thiet-ke/csdl.md) §3; [ADR-017](../../04-thiet-ke/adr/ADR-017-inbox-outbox-idempotency.md).

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Công bố đủ bốn tuyến CHAN: `POST /channels/{channelId}/sync`, `PUT /channels/{channelId}/mappings`, `POST /channels/{channelId}/sales-closure`, `GET /channels/{channelId}/ota-bookings`; URL có tiền tố `/api/v1`. Tái sử dụng DTO cấu hình kênh đã có, không tạo bản sao khác ngữ nghĩa. — test: `packages/contracts/test/f6/channel.spec.ts::channel-routes`.
2. Công bố đủ mười một tuyến OVER: `GET /overbooking-cases`, `GET /overbooking-cases/{caseId}`, `POST /overbooking-cases/{caseId}/relocation-plan`, `POST /overbooking-cases/{caseId}/resolve`, tạo/duyệt/thực thi `room-moves`, tạo/consent/duyệt/thực thi `room-merges`. Tạo phương án trả trạng thái `PROPOSED`, không mô tả là đã gán phòng; thêm mô tả để sửa nhãn tóm tắt cũ của API §2.8. — test: `packages/contracts/test/f6/overbooking.spec.ts::over-routes-and-proposal-state`.
3. Request ghi dùng schema strict; tiền VND nguyên không âm trong miền số nguyên an toàn của transport hiện hành, Booking.seq truyền chuỗi thập phân để không mất bigint, ID/ngày/enum được validate, `[from,to)` rõ ràng, phân trang giới hạn theo API §1.5. Trường chi phí, version và PIN chỉ có ở đúng lệnh; không nhận `approvedBy`, `keepScore`, `priceLocked`, `oversold` hoặc tổng tiền do frontend tự quyết. — test: `packages/contracts/test/f6/validation.spec.ts::reject-invalid-and-server-owned-fields`.
4. Lệnh ghi idempotent theo BR-GEN-08/API §1.6; lệnh sửa đối tượng có version nhận `If-Match` và response `ETag`. Client giữ nguyên key khi retry cùng payload, mang cookie/header/session theo runtime đã có. OpenAPI mô tả thiếu version → 428, lệch version → 412, key dùng lại khác payload → 409; không bắt `If-Match` cho tạo mới chưa có version. — test: `packages/api-client/test/f6/transport.spec.ts::idempotency-and-version-headers`.
5. Response case/plan trả `shortageCount`, deadline, trạng thái, dấu quá hạn, lịch sử xử lý và **đủ bốn bậc**; bậc 3 hiện `feasible=false` kèm lý do 160–300 km. Ứng viên có nhóm ưu tiên yếu/mạnh, các thành phần `keepScore`, `createdAt`, `Booking.seq` và thứ tự server; không dùng UUID làm tie-break. — test: `packages/contracts/test/f6/overbooking.spec.ts::complete-ladder-and-rank-breakdown`.
6. Move gắn `bookingRoomId`, nguồn/đích, `priceLocked=true`, chi phí, trạng thái duyệt/thực thi. Merge phân biệt share/connecting, hai consent và bằng chứng, phê duyệt, chiết khấu riêng; walk-out có chứng từ/chữ ký và tham chiếu hồ sơ hoàn/bồi thường do F5 quản lý. Không có endpoint sửa price snapshot. — test: `packages/contracts/test/f6/overbooking.spec.ts::move-merge-walkout-and-immutable-price`.
7. Mã lỗi CHAN/OVER theo API §4.2 gắn đúng HTTP và thông điệp: signature 401; event ID khác hash 409; consent thiếu 409 `E_OVER_NO_CONSENT`; khác giới/UNSPECIFIED đủ consent chưa duyệt 409 `E_OVER_MERGE_GENDER`; thiếu duyệt chi phí 403; tồn/version/quyền/PIN đúng mã đã có. Trạng thái quá hạn vẫn cho luồng xử lý sự cố sau leo thang theo BR-OVER-16, không dùng lỗi deadline để cấm mọi execute. — test: `packages/contracts/test/f6/errors.spec.ts::error-status-and-late-resolution`.
8. Schema webhook simulator khai `booking.created/modified/cancelled`, timestamp/provider key, chữ ký raw body và event ID; ACK mới bền 202, trùng hash 200, timestamp ngoài ±300 giây 401, cùng event ID khác hash 409. Dòng phản hồi API §5.1 đã được đồng bộ trong PR công bố đặc tả; hợp đồng sinh ra phải khớp định nghĩa chữ ký và `E_CHAN_REPLAY_DETECTED`, không phá vỡ hợp đồng đã phát hành. Không mô tả simulator là API thật của đối tác. — test: `packages/contracts/test/f6/channel.spec.ts::ota-inbox-ack-contract`.
9. Mỗi route ánh xạ tập permission của API §6.3; MANAGER/OWNER xử lý case và đồng bộ, OWNER sửa ánh xạ cấu hình; FRONT_DESK thực thi move/merge; MANAGER/OWNER duyệt; ACCOUNTANT chi tiền qua F5. Response danh sách che PII và bí mật; tài khoản kỹ thuật không được mặc nhiên xem nghiệp vụ. — test: `packages/contracts/test/f6/permissions.spec.ts::all-f6-routes-fail-closed`.
10. Tác vụ sync trả `{operationId,status,statusUrl}` và `Location`, dùng lại route đọc operation có kiểm quyền. Các client chạy qua HTTP server kiểm soát được, kiểm body/header/mã lỗi thực; sinh lại OpenAPI, 0 phá vỡ và không sửa baseline bảo vệ. — test: `packages/api-client/test/f6/transport.spec.ts::http-client-and-async-operation`; `packages/contracts/test/f6/openapi.spec.ts::published-paths`.
11. Bổ sung không phá vỡ các tuyến còn thiếu để SCR-40/41/42 có backend thực: `GET /channels` (projection theo scope, tái sử dụng nếu F3 đã công bố), `GET /channels/{channelId}/sync-status`, `GET /channels/{channelId}/outbox-deliveries`, `POST /channels/{channelId}/outbox-deliveries/{deliveryId}/retry` do HB-131 hiện thực; `POST /channels/{channelId}/ota-bookings/{bookingId}/duplicate-flag` do HB-129 hiện thực. Retry giữ event/consumer key, flag nhận `flagged` và `reason` với version hiện hành, không tự huỷ booking hay sửa tiền. Chỉ MANAGER/OWNER trong scope; response che payload, credentials và PII. Ghi route mới vào API §2.7/§6.3, client HTTP tương ứng. — test: `packages/contracts/test/f6/channel.spec.ts::operations-read-retry-and-duplicate-review`; `packages/api-client/test/f6/transport.spec.ts::operations-channel-clients`.
12. Bổ sung đường đọc để chuyển việc và đối soát kết quả: `GET /room-moves/{roomMoveId}`, `GET /room-merges/{roomMergeId}` do HB-125 hiện thực, trả ETag/trạng thái/chứng từ đã che và allowedActions cho FRONT_DESK/MANAGER/OWNER có scope; `GET /bookings/{bookingId}/relocation-options` do HB-125 hiện thực cho FRONT_DESK chỉ đọc phương án của booking ấy, không lộ bảng xếp hạng/PII booking khác. `GET /overbooking-alerts` do HB-126 hiện thực cho FRONT_DESK có scope, chỉ projection booking cần xử lý, ngày và liên kết được phép; API case/keepScore toàn bộ vẫn MANAGER/OWNER. Thêm trường tra cứu ý định ghi theo quyền hiện tại để UI không tạo key mới khi timeout chưa rõ kết quả. — test: `packages/contracts/test/f6/permissions.spec.ts::booking_projection_move_merge_read_and_scope`; `packages/api-client/test/f6/transport.spec.ts::handoff_and_unknown_result_reads`.
13. Chi bồi thường dùng hợp đồng riêng F6 `POST /room-moves/{roomMoveId}/compensation-payments` và `GET /room-moves/{roomMoveId}/compensation-payments` do HB-125 hiện thực qua test khoá HB-124, không dùng `/refund-requests/{id}/pay` cho COMPENSATION. Chỉ ACCOUNTANT chi trong scope; request có Idempotency-Key/If-Match/PIN, tham chiếu phê duyệt hiện hành và bằng chứng hoặc intent của adapter chi được lead chọn; số tiền lấy từ quyết định đã duyệt, không tin client tự khai. Phản hồi tách PENDING/không rõ kết quả khỏi SUCCEEDED, có payment/operation ID bền để tra lại. MANAGER/OWNER đọc chứng từ duyệt và trạng thái theo projection cần nhiệm vụ, không được chi vì có quyền đọc. Lead xác nhận adapter/phương thức chi và phần mở rộng PAY trước khi khoá AC runtime. — test: `packages/contracts/test/f6/permissions.spec.ts::compensation_accountant_only_and_approved_amount`; `packages/api-client/test/f6/transport.spec.ts::compensation_intent_and_status`.
14. sales-closure thêm `closed` tùy chọn, mặc định true để giữ hành vi đã phát hành; false chỉ gỡ manual closure, server vẫn áp auto closure/quota. Projection nêu lý do đóng manual/automatic riêng. Sync-status phục hồi OK/counter0 sau success xác minh, giữ lịch sử lỗi; case list metadata nêu lần scan thành công/trạng thái scan để UI phân biệt rỗng với chưa biết. Ghi quy ước kỹ thuật này vào API và dùng với HB-121/126/127/131 trước lock test — test: `packages/contracts/test/f6/channel.spec.ts::closure_provenance_and_sync_recovery`; `packages/contracts/test/f6/overbooking.spec.ts::scan_freshness_metadata`.

## Ngoài phạm vi

- Backend, engine, worker, màn hình; thay đổi BR hoặc cấp thêm quyền ngoài API §6.3.
- API thật của Booking.com/Agoda/Airbnb; thêm đường chi hoàn riêng cho F6.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check:docs`; sinh bằng `pnpm openapi:generate` rồi kiểm `pnpm check:openapi`. Khi sửa tài liệu, áp dụng đầy đủ cổng `npm run check` theo AGENTS.md.

## Ghi chú cho người làm

- File dùng chung `registry.ts`, `index.ts`, enums/errors chỉ thêm phần đăng ký; rebase và sinh lại OpenAPI nếu F4/F5 đã thêm hợp đồng.
- Các tên test ở trên là yêu cầu kiểm chứng để người thi công tạo, chưa phải test khoá. R2 này là hợp đồng có người làm theo backlog; backend liên quan tiền/tồn được khoá riêng ở HB-124/126/128/131.
- Ưu tiên BR khi TC cũ đòi từ chối booking OTA đã xác nhận vượt allotment hoặc nhầm mã lỗi ghép khác giới. Không đưa luật cũ ấy vào schema.
- Biểu diễn MERGE_CONNECTING một hay hai booking chưa đồng bộ giữa tài liệu nghiệp vụ chi tiết và DDL hiện hành: lead chốt trước khi công bố phần schema connecting, rồi cập nhật HB-121/123/124/125/137 tương ứng. Không dùng sự thiếu trường của API để tự bắt khách lập booking thứ hai.
