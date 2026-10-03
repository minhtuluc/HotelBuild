---
id: HB-128
title: Simulator OTA và inbox bền trước ACK, xác minh HMAC trước dedup
risk: R2
owner: deepseek
max_lines: 650
allow:
  - apps/api/src/modules/chan/webhooks/**
  - apps/api/src/modules/chan/adapters/**
  - apps/api/src/modules/integrations/inbox/**
  - apps/api/src/app.module.ts
  - apps/api/test/ota-inbox/**
  - scripts/simulators/ota/**
locked:
  - apps/api/test/ota-inbox/signature.locked.spec.ts
  - apps/api/test/ota-inbox/durability.locked.spec.ts
  - apps/api/test/ota-inbox/simulator.locked.spec.ts
---

# HB-128 — Simulator OTA và inbox bền trước ACK

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Nhận sự kiện từ simulator Pine Hill của ba OTA, xác minh nguồn/chữ ký trước khi giữ khoá dedup và commit inbox trước ACK. HTTP tiếp nhận tách khỏi transaction áp booking ở HB-129; mất DB hoặc queue không được làm mất cam kết đã ACK.

## Căn cứ

- Pha F6: [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md); [backlog](../backlog-f6-f7.md), HB-128.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) BR-CHAN-02…04/06, BR-GEN-08; [yêu cầu](../../01-yeu-cau/yeu-cau-chuc-nang.md) FR-CHAN-04/05/08; [use case](../../01-yeu-cau/mo-hinh-use-case.md) UC-CHAN-03.
- [API](../../04-thiet-ke/api.md) §5.1, §5.3: `POST /api/v1/integrations/ota/{channel}/bookings`; `E_CHAN_SIGNATURE_INVALID`, `E_CHAN_REPLAY_DETECTED`, `E_GEN_VALIDATION_FAILED`.
- [ADR-017](../../04-thiet-ke/adr/ADR-017-inbox-outbox-idempotency.md) quyết định 3–5; [CSDL](../../04-thiet-ke/csdl.md) §3.2.8/§3.6 `webhook_inbox`.
- [Kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md) TC-CHAN-08/09/11; [NFR](../../01-yeu-cau/yeu-cau-phi-chuc-nang.md) NFR-SEC-05, NFR-REL-06, NFR-PERF-05.

## Phụ thuộc và bàn giao A → B

- Backlog: HB-120 (hợp đồng), HB-095 (inbox PSP dùng chung). HB-129 áp booking; HB-121 cung cấp migration nếu phát hiện schema thiếu.
- **A — Codex:** viết ba file test khoá trong `locked`, fixture synthetic và hợp đồng simulator; chạy trên HTTP/DB thật, ghi bằng chứng đỏ đúng lý do chức năng thiếu. Có thể dùng adapter OTA giả tại ranh giới mạng; không mock verifier/repository đang kiểm.
- **Merge A trước B. B — DeepSeek:** chỉ bắt đầu từ commit đã tích hợp A; hiện thực để ba file khoá xanh, không sửa fixture/assertion trong file khoá. Owner frontmatter là người thực hiện B; chuỗi owner backlog vẫn là Codex (test khoá) → DeepSeek.
- Danh sách `locked` áp dụng bàn giao B. `check:scope` hiện chặn cả việc tạo file khoá; lead phải tổ chức phạm vi tích hợp A trước khi giao B. Codex/DeepSeek không tự thêm `unlock`, không sửa ticket trên main để vượt cổng. Đỏ chức năng ở A là bằng chứng bàn giao, không được báo CI xanh hoặc dùng skip.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test tương lai)

1. `{channel}` chỉ ánh xạ `booking/agoda/airbnb` sang `OTA_BOOKING/OTA_AGODA/OTA_AIRBNB`; account được lấy từ cấu hình adapter đã xác thực, không tin channel/account trong payload để chọn bí mật hoặc scope — test: `apps/api/test/ota-inbox/signature.locked.spec.ts::channel-account-binding`.
2. Ký đúng raw bytes bằng HMAC-SHA256 với chuỗi `t + "." + rawBody`; kiểm hex/độ dài trước so sánh constant-time; sai chữ ký, body bị sửa, chữ ký kênh khác hoặc header sai cấu trúc trả `401 E_CHAN_SIGNATURE_INVALID`, không ghi inbox/dedup/booking — test: `apps/api/test/ota-inbox/signature.locked.spec.ts::verify-before-dedup`.
3. Với clock tiêm vào, lệch đúng ±300 giây được nhận, ±301 bị 401; event giả dùng ID thật không chiếm khoá của lần gửi hợp lệ sau đó — test: `apps/api/test/ota-inbox/signature.locked.spec.ts::timestamp-boundary-and-poisoning`.
4. Event hợp lệ thuộc `booking.created/modified/cancelled` commit `webhook_inbox` với provider/account/eventId/hash/payload nghiệp vụ bảo vệ/signatureVerifiedAt trước `202`; payload sai cấu trúc trả `400 E_GEN_VALIDATION_FAILED` — test: `apps/api/test/ota-inbox/durability.locked.spec.ts::durable-before-202`.
5. DB thất bại trước commit không ACK thành công; commit xong nhưng crash trước enqueue hoặc Redis mất dữ liệu vẫn còn inbox PENDING để HB-129 quét phục hồi — test: `apps/api/test/ota-inbox/durability.locked.spec.ts::db-failure-and-queue-loss`.
6. Mỗi HTTP mới verify lại trước dedup; trong 7 ngày cùng `(provider,account,eventId)` và hash trả `200 {"duplicate":true}` kể cả inbox đang chờ; 5 lần gửi đồng thời chỉ một dòng inbox, không thay payload gốc — test: `apps/api/test/ota-inbox/durability.locked.spec.ts::seven-day-concurrent-replay`.
7. Cùng ID khác hash sau verify trả `409 E_CHAN_REPLAY_DETECTED`, giữ bản gốc và dấu đối soát; cùng ID ở account khác không bị gộp; hết TTL sự kiện không xoá uniqueness booking `(channelId,externalRef)` của HB-129 — test: `apps/api/test/ota-inbox/durability.locked.spec.ts::hash-conflict-and-account-isolation`.
8. Simulator nhận clock/kịch bản/seed tường minh, bơm 20 sự kiện đa kênh trong ≤5 phút; tạo được chữ ký sai, timeout, retry 5 lần, modified/cancelled sai thứ tự; ở ticket này kiểm 20 inbox bền, payload chuẩn hoá và replay không nhân inbox. Kiểm booking/case sau khi nối HB-129 thuộc HB-194, không đặt phụ thuộc ngược HB-128 → HB-129 để vượt cổng ticket — test: `apps/api/test/ota-inbox/simulator.locked.spec.ts::twenty-events-and-replay`.
9. Đo HTTP ingestion p95 ≤300 ms trên fixture và môi trường ghi trong log bằng chứng, không chờ áp booking hay gửi OTA; log chỉ correlation/event ID và lỗi đã che, không chứa raw payload/SĐT/bí mật HMAC — test: `apps/api/test/ota-inbox/simulator.locked.spec.ts::ack-latency-and-safe-logs`.

## Ngoài phạm vi

- API thật của các đối tác, credential thật; đổi hợp đồng simulator thành tuyên bố tương thích production OTA.
- Áp tạo/sửa/huỷ booking và ghi tiền (HB-129), outbox relay (HB-130), đồng bộ ra (HB-131), màn SCR-42 (HB-134).
- Sửa nguồn docs/01–02, ticket trên main, file bảo vệ hoặc thay schema nền âm thầm.

## Cổng phải xanh

Ở B: `pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check` khi đụng docs/scripts/DDL; `pnpm --filter @pinehill/api test test/ota-inbox` với PostgreSQL 16. Chạy thật `pnpm infra:up` + `pnpm migrate`, gửi HTTP có/không chữ ký và chạy simulator; ghi ACK, số dòng inbox, số booking khi HB-129 đã tích hợp. CI PR phải xanh trên đúng commit nộp. Không có script `pnpm test:integration` trong package hiện hành; dùng lệnh workspace cụ thể. Bằng chứng A ghi riêng các ca đỏ dự kiến.

## Ghi chú cho người làm

HMAC/header là hợp đồng simulator Pine Hill. Reuse inbox HB-095 bằng seam tối thiểu và phối hợp owner; không làm đổi ACK PSP. Dedup HTTP là 7 ngày, không dùng TTL 24h của API command. Chốt và ghi rõ retention/hash scope trong contract test, không chứa PII. API §5.1 đã được đồng bộ với §4.2 trong PR công bố đặc tả: ca quá ±300s dùng 401, cùng ID khác hash dùng 409; không tự sáng tạo lỗi. Retry hợp lệ sau 30 phút phải có timestamp/chữ ký mới, giữ eventId và payload; không phát lại header cũ ngoài cửa sổ rồi mong ACK.

### Điều kiện bàn giao test A

Lead phải giải quyết mâu thuẫn giữa “merge test đỏ A trước B” (sổ tay lead §3.6) và “CI xanh mới được merge” (AGENTS §3, merge guard). Bản nháp không cấp ngoại lệ: đề xuất A bàn giao SHA/test bất biến có log đỏ, B tích hợp trên đúng SHA, lead xuất bản A+B khi CI xanh với scope được duyệt. Không đổi CI, skip hoặc tự mở lead branch để vượt guard; chờ lead chốt cơ chế trước thi công A.
