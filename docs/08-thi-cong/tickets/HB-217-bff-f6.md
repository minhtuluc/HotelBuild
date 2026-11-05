---
id: HB-217
title: Tuyến BFF phiên nhân viên cho các màn F6 (CHAN, OVER, hoàn tiền ngoại lệ, PIN)
risk: R1
owner: deepseek
max_lines: 1100
allow:
  - apps/operations-web/src/app/api/session/sys/channels/**
  - apps/operations-web/src/app/api/session/sys/overbooking-cases/**
  - apps/operations-web/src/app/api/session/sys/room-moves/**
  - apps/operations-web/src/app/api/session/sys/room-merges/**
  - apps/operations-web/src/app/api/session/sys/refund-requests/**
  - apps/operations-web/src/app/api/session/sys/bookings/**
  - apps/operations-web/src/app/api/session/sys/auth/pin/**
  - apps/operations-web/src/app/api/session/sys/f6-route.ts
  - apps/operations-web/test/f6-bff/**
  - packages/api-client/src/client.ts
  - packages/api-client/test/client.spec.ts
locked:
unlock:
---

# HB-217 — Tuyến BFF phiên nhân viên cho các màn F6

> Ticket do người thay vai lead cấp sau mẻ F6 UI (HB-132…HB-139). Nguồn: kiểm kê khi dựng 7 màn web F6 — trình duyệt
> chỉ gọi API qua `app/api/session/sys/**` (nhà máy `lib/ops-session.ts`, HB-201) mà **29 lời gọi F6 chưa có tuyến BFF**,
> nên các PR #236–#242 chạy được với API giả của Playwright nhưng sẽ 404 trên stack thật.

## Mục tiêu

Mọi lời gọi của SCR-40…SCR-47 (và SCR-38 phần danh sách/duyệt hoàn) đi qua BFF phiên nhân viên đúng mẫu HB-201: tuyến chỉ
**chuyển tiếp có kiểm tra** tới API bằng token của phiên, giữ nguyên `Idempotency-Key`, `If-Match`/`ETag`, `Retry-After` và mã
lỗi nghiệp vụ; không thêm logic nghiệp vụ, không lộ dữ liệu ngoài hợp đồng.

## Căn cứ

- Pha F6 — [lộ trình thi công §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out); mẫu BFF: HB-019 (`packages/web-session`), HB-201.
- API [§1.3, §1.6](../../04-thiet-ke/api.md) (ETag/If-Match, Idempotency-Key), §2.7–2.8, §2.6, §3.9–3.10; hợp đồng HB-120 (`packages/contracts/src/{channel,overbooking,overbooking-move,refund,auth}.ts`).
- Mã tham chiếu: `app/api/session/sys/{holds/[id],channel-allotments,channels/[id],operations/[id]}/route.ts`; `packages/web-session/src/journey.ts` (`createJourneyHandler`, `JourneyRoute`).
- Ràng buộc của nhà máy chung (`journey.ts`) đã có và **không đổi**: mọi lệnh ghi bắt buộc `Origin` đúng + `X-Session-Request: 1` (CSRF) và `Idempotency-Key` UUIDv4; truy vấn lạ bị từ chối; `If-Match` được chuyển tiếp; `ETag` và `Idempotency-Replayed` được trả lại; chi tiết lỗi chỉ qua danh sách trắng `validationFields`.

## Phạm vi — 29 tuyến (tên đường dẫn BFF = `/api/session/sys` + cột 2)

Cột "Body/Query/Phản hồi" là schema của `@pinehill/contracts` dùng làm `body`, `query` và `decoder` của `JourneyRoute` (phản hồi chỉ được qua decoder — trường lạ bị cắt).

| # | Phương thức + đường dẫn BFF | Upstream (`/api/v1`) | Body / Query / Phản hồi | `If-Match` |
|---|---|---|---|---|
| 1 | `PUT /channels/{id}/mappings` | giống | `channelMappingPutRequestSchema` / — / `channelMappingsViewSchema` | tuỳ chọn (tạo mới không có) |
| 2 | `POST /channels/{id}/sales-closure` | giống | `salesClosureRequestSchema` / — / `salesClosureViewSchema` | — |
| 3 | `POST /channels/{id}/sync` | giống | `channelSyncRequestSchema` / — / `operationRefSchema` (202) | — |
| 4 | `GET /channels/{id}/sync-status` | giống | — / — / `channelSyncStatusViewSchema` | — |
| 5 | `GET /channels/{id}/outbox-deliveries` | giống | — / `outboxDeliveriesQuerySchema` / `listResponseSchema(outboxDeliverySchema)` | — |
| 6 | `POST /channels/{id}/outbox-deliveries/{deliveryId}/retry` | giống | không body / — / `operationRefSchema` (202) | — |
| 7 | `GET /channels/{id}/ota-bookings` | giống | — / `otaBookingsQuerySchema` / `listResponseSchema(otaBookingSchema)` | — |
| 8 | `POST /channels/{id}/ota-bookings/{bookingId}/duplicate-flag` | giống | `otaBookingFlagRequestSchema` / — / `otaBookingSchema` | bắt buộc |
| 9 | `GET /overbooking-cases` | giống | — / `overbookingCasesQuerySchema` / `overbookingCaseListSchema` | — |
| 10 | `GET /overbooking-cases/{id}` | giống | — / `overbookingCaseDetailQuerySchema` / `overbookingCaseDetailSchema` | — |
| 11 | `POST /overbooking-cases/{id}/relocation-plan` | giống | `relocationPlanRequestSchema` / — / `relocationPlanSchema` | bắt buộc |
| 12 | `POST /overbooking-cases/{id}/resolve` | giống | `overbookingResolveRequestSchema` / — / `overbookingResolveResponseSchema` | bắt buộc |
| 13 | `GET /bookings/{id}/relocation-options` | giống | — / `relocationOptionsQuerySchema` / `bookingRelocationOptionsSchema` | — |
| 14 | `POST /room-moves` | giống | `roomMoveCreateRequestSchema` / — / `roomMoveSchema` (201) | — |
| 15 | `GET /room-moves/{id}` | giống | — / `writeIntentQuerySchema` / `roomMoveViewSchema` (+`ETag`) | — |
| 16 | `POST /room-moves/{id}/approve` 🔒 | giống | `roomMoveApproveRequestSchema` / — / `roomMoveSchema` | bắt buộc |
| 17 | `POST /room-moves/{id}/execute` 🔒 | giống | `roomMoveExecuteRequestSchema` / — / `roomMoveSchema` | bắt buộc |
| 18 | `GET /room-moves/{id}/compensation-payments` | giống | — / — / `compensationPaymentsViewSchema` | — |
| 19 | `POST /room-moves/{id}/compensation-payments` 🔒 | giống | `compensationPaymentCreateRequestSchema` / — / `compensationPaymentSchema` | bắt buộc |
| 20 | `POST /room-merges` | giống | `roomMergeRequestSchema` / — / `roomMergeSchema` | — |
| 21 | `GET /room-merges/{id}` | giống | — / `writeIntentQuerySchema` / `roomMergeViewSchema` (+`ETag`) | — |
| 22 | `POST /room-merges/{id}/consent` | giống | `roomMergeConsentRequestSchema` / — / `roomMergeSchema` | bắt buộc |
| 23 | `POST /room-merges/{id}/approve` | giống | `roomMergeApproveRequestSchema` / — / `roomMergeSchema` | bắt buộc |
| 24 | `POST /room-merges/{id}/execute` | giống | không body / — / `roomMergeSchema` | bắt buộc |
| 25 | `GET /refund-requests` | giống | — / `refundListQuerySchema` / `listResponseSchema(refundRequestSchema)` | — |
| 26 | `POST /refund-requests` | giống | `refundRequestCreateRequestSchema` / — / `refundRequestSchema` | — |
| 27 | `POST /refund-requests/{id}/approve` 🔒 | giống | `refundApproveRequestSchema` / — / `refundDecisionSchema` | — |
| 28 | `POST /refund-requests/{id}/reject` 🔒 | giống | `refundRejectRequestSchema` / — / `refundRequestSchema` | — |
| 29 | `POST /auth/pin/verify` | giống | `pinVerifyRequestSchema` / — / `pinTokenSchema` | — |

🔒 = lệnh cần PIN: `pinToken` do trình duyệt đặt **trong thân** (client chung `pinProtected`); BFF không giữ, không ghi log, không đọc lại PIN.

Đã có sẵn, **không sửa**: `channels` (GET danh sách), `channels/[id]` (GET/PATCH), `channel-allotments`, `properties`, `room-types`, `operations/[id]`, `auth/me`.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. Catalogue đủ 29 tuyến trên; mỗi tuyến chuyển tiếp đúng phương thức và đường dẫn upstream (id được `encodeURIComponent` sau `decodedId`), không có tuyến bắt-tất-cả (`[...path]`) và không mở tuyến nào ngoài bảng. — test: `apps/operations-web/test/f6-bff/catalogue.spec.ts::catalogue_matches_spec_and_has_no_catch_all`
2. Lệnh ghi thiếu `Origin`/`X-Session-Request` ⇒ 403; thiếu hoặc sai `Idempotency-Key` UUIDv4 ⇒ 400; thiếu bearer ⇒ 401 — kiểm cho **cả 19 lệnh ghi** (các dòng PUT/POST của bảng). — test: `apps/operations-web/test/f6-bff/writes.spec.ts::csrf_key_and_session_required`
3. `If-Match` đi qua nguyên văn tới upstream; `ETag` của upstream về tới trình duyệt (tuyến 15, 21 và mọi lệnh trả hồ sơ); `Idempotency-Replayed` được giữ; phản hồi 202 giữ nguyên mã trạng thái. — test: `…/writes.spec.ts::etag_if_match_and_replay_headers`
4. Truy vấn: khoá lạ hoặc lặp ⇒ 400; giá trị theo schema (`overdueOnly`, `limit`, `dateFrom/dateTo`…) được chuyển tiếp đúng kiểu; **không** tự thêm tham số. Bẫy đã biết: `z.coerce.boolean` coi `"false"` là `true` — tuyến 9 chỉ chấp nhận `overdueOnly=true` hoặc vắng mặt. — test: `…/queries.spec.ts::query_allowlist_and_boolean_trap`
5. Thân sai schema, thân quá 16 KiB hoặc không phải JSON ⇒ 400 mã `E_GEN_VALIDATION_FAILED` và **không** gọi upstream; trường lạ trong phản hồi upstream bị cắt bởi `decoder`, không lọt xuống trình duyệt. — test: `…/writes.spec.ts::body_validation_and_response_stripping`
6. Mã lỗi nghiệp vụ và trạng thái của upstream đi qua nguyên vẹn, **kể cả** 401/403 nghiệp vụ: `E_OVER_APPROVAL_REQUIRED` (403), `E_PAY_SELF_APPROVAL` (403), `E_AUTH_PIN_REQUIRED` (401), `E_AUTH_PIN_LOCKED` (403, kèm `Retry-After`), `E_INV_ROOM_TAKEN`/`E_OVER_NO_CONSENT`/`E_OVER_MERGE_GENDER`/`E_OVER_CASE_DEADLINE_PASSED` (409), 412/428, 409 `E_SYS_REQUEST_IN_PROGRESS` (+`Retry-After`). `details` chỉ qua danh sách trắng tên trường theo từng tuyến (liệt kê trong mã, lấy từ các schema ở bảng). — test: `…/errors.spec.ts::business_errors_pass_through_with_whitelisted_details`
7. Dữ liệu riêng tư không rò: tên, email, SĐT, `evidenceUrl`, `pinToken`, `Authorization` không xuất hiện trong thân lỗi, log hay `console`; test chạy với upstream trả thân lỗi chứa dữ liệu giả có dấu hiệu nhận biết. — test: `…/errors.spec.ts::private_data_not_leaked_to_logs_or_errors`
8. **Client không phát lại 401 của `POST /auth/pin/verify`.** Hiện `ApiClient.onUnauthorized` làm mới phiên rồi gửi lại 401 của mọi đường dẫn không nằm trong `CREDENTIAL_PATHS`; với PIN sai (401) lần gửi lại bị đếm hai lần vào ngưỡng khoá 3 lần (cùng lỗi Android đã tránh ở HB-154). Thêm `/auth/pin/verify` vào danh sách không phát lại (một dòng + test), **không** đổi hành vi các đường dẫn khác. — test: `packages/api-client/test/client.spec.ts::pin_verify_401_is_not_replayed`
9. Chạy đầu–cuối thật: `opsSessionClient` → BFF (handler thật) → API giả qua TCP, cho **một tuyến đại diện của mỗi nhóm** (CHAN lệnh ghi, OVER lệnh PIN, danh sách hoàn, `pin/verify`): khoá/`If-Match`/PIN ngoài URL, đúng một lệnh ghi tới upstream khi trình duyệt gửi lại cùng khoá. — test: `apps/operations-web/test/f6-bff/runtime.spec.ts::client_to_bff_to_upstream_round_trip` (theo mẫu `test/admin-routes/runtime.ts`, trần thời gian tường minh như HB-202)
10. Mọi `modules` mà 7 màn F6 khai với `useOpsSession`/`opsSessionClient` (`/auth`, `/properties`, `/room-types`, `/channels`, `/channel-allotments`, `/operations`, `/overbooking-cases`, `/room-moves`, `/room-merges`, `/refund-requests`, `/bookings`) đều có ít nhất một tuyến tương ứng trong catalogue. — test: `…/catalogue.spec.ts::every_declared_screen_module_has_routes` (đọc nguồn các màn, không sửa chúng)

## Ngoài phạm vi

- Không sửa màn hình, `lib/ops-session.ts`, `packages/{contracts,web-session}`, API/worker, quyền ở máy chủ.
- Không thêm tuyến cho `GET /overbooking-alerts` (chỉ Android, gọi thẳng API) và không thêm lệnh nào ngoài bảng.
- Không đụng các màn cũ gọi thẳng `NEXT_PUBLIC_API_BASE_URL` (SCR-37 thu tiền, SCR-39 đối soát, SCR-48 bàn tiền sảnh, người dùng): đây là **kiểm kê riêng** — chúng không đi qua BFF nên cần quyết định thống nhất đường truyền (chuyển sang BFF hay giữ gọi thẳng + CORS) ở ticket sau, không “tiện thể” trong ticket này. SCR-38 phần danh sách/duyệt hoàn đã được tuyến 25–28 phủ nếu màn được nối BFF.
- Không đổi hành vi `ApiClient` ngoài một dòng ở tiêu chí 8.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm --filter @pinehill/operations-web test` · `pnpm --filter @pinehill/api-client test` · build web (`pnpm --filter @pinehill/operations-web build`) để Next nhận đủ tuyến mới · `pnpm test:e2e` project `operations-web` (kiểm không hồi quy `channels.spec.ts`).

## Ghi chú cho người làm

- Một tệp trợ giúp `sys/f6-route.ts` (hoặc tên tương đương) gom boilerplate `createJourneyHandler({...sessionConfig(), validationFields, routeResolver})`; mỗi `route.ts` chỉ khai bảng tuyến của mình (mẫu `holds/[id]`, `channel-allotments`). Mọi tuyến `protected: true`. Không `export const runtime` Edge; giữ `dynamic = 'force-dynamic'`.
- Tuyến động dùng `decodedId` (`sys/route-id.ts`) cho **mọi** đoạn id (`channels/{id}`, `{deliveryId}`, `{bookingId}`…). Thư mục `channels/[id]/` đã có `route.ts` (GET/PATCH): thêm thư mục con, **không sửa** tệp đó.
- Trình duyệt không bao giờ biết URL API; BFF dùng `webEnv().NEXT_PUBLIC_API_BASE_URL` qua `sessionConfig()`. `maxAttempts: 1` ở nhà máy chung — việc thử lại thuộc client/màn hình (cùng khoá), không thuộc BFF.
- Chi tiết 409 chỉ nhận qua `validationErrorCodes` khi hợp đồng công bố có `details` an toàn; mặc định **không** bật.
- Các màn F6 đang ở PR nháp #236–#242 (HB-132…138); chúng khai `modules` như tiêu chí 10 và dựa vào đúng bảng này. Nếu bảng đổi, đổi cả hai phía.
- Bằng chứng chạy trên API thật (HB-194) nằm ngoài ticket này; báo trong PR: tuyến đã thêm · tuyến chưa thử trên API thật vì backend #232–#235 chưa vào `main`.
