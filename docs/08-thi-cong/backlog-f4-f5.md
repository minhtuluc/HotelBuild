# Backlog F4–F5 — journey khách, giữ chỗ, thanh toán, huỷ/hoàn

Mục lục: [backlog](backlog.md) · [lộ trình đến deploy](lo-trinh-den-deploy.md) · [sổ tay lead](so-tay-lead.md). F4 + F5 là trung tâm tiền và tồn: mọi ticket R2 ở đây theo đường R2 đầy đủ (Codex test khoá → DeepSeek → Gemini → Codex → lead ký).

## Nền chung (bắt buộc trước F4)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| HB-029 | Middleware idempotency bền: khoá `(principal, operation, Idempotency-Key)` + hash payload, `idempotency_keys` TTL 24h, replay trả bản đã commit, khác hash → xung đột; kiểm quyền trước replay | R2 | Codex (test khoá) → DeepSeek | HB-007, HB-009, HB-014 | ADR-017; BR-GEN-08, BR-PAY-03; api.md §1.6; QĐ-03 T9 | Hai request cùng khoá đồng thời chỉ một tác động, request sau nhận `Idempotency-Replayed`; mất Redis không gây thực hiện lần hai |

## F4 — tìm → báo giá → chọn gói → đặt → giữ chỗ (customer web + customer Android)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| HB-070 | Hợp đồng F4: `inventory/availability`, `quotes`, `bookings`, `bookings/{id}/confirm`, `holds`, `DELETE holds/{id}` + mã `E_RATE_QUOTE_EXPIRED`, `E_BOOK_MISSING_FIELD`, `E_BOOK_OVER_CAPACITY`, `E_BOOK_MIN_NIGHTS`, `E_BOOK_SOLD_OUT`, `E_BOOK_INVALID_STATE`, `E_BOOK_BLACKLISTED`, `E_INV_ROOM_TAKEN` (rate-plans thuộc HB-050) | R2 | DeepSeek | HB-027, HB-050 | api.md §2.3–§2.5, §3.1, §3.2, §3.4; FR-INV-02, FR-BOOK-01 | 0 phá vỡ; DTO khớp ví dụ api.md |
| HB-071 | Migration tiến F4 nếu §3 thiếu (hold, snapshot ORIGINAL, reservation khuyến mãi) | R2 | Codex | HB-005, HB-010 | csdl §3; ADR-014, ADR-015; BR-BOOK-07, BR-INV-02 | Schema migration ↔ §3 khớp |
| ~~HB-072~~ | Gộp vào HB-032 (engine tồn) | — | — | — | — | — |
| ~~HB-073~~ | Gộp vào HB-052 (engine giá) | — | — | — | — | — |
| HB-074 | UC + endpoint `POST /quotes`: quote bất biến TTL 900 giây, gắn principal + fingerprint | R2 | Codex (test khoá) → DeepSeek | HB-070, HB-052, HB-029 | ADR-015; api.md §3.1; BR-RATE-15 | Sai kênh/ngày/khách → `E_RATE_QUOTE_MISMATCH`; hết hạn → 410, không tự tăng giá |
| HB-075 | UC + endpoint `GET /inventory/availability` (chỉ đọc) | R1 | DeepSeek | HB-070, HB-032 | api.md §3.8; UC-INV-02; BR-BOOK-03 | Khớp engine HB-032 |
| HB-076 | UC + endpoint `POST/DELETE /holds`: khoá theo thứ tự ADR-014, `23P01` → `E_INV_ROOM_TAKEN`, `holdExpiresAt` theo kênh | R2 | Codex (test khoá) → DeepSeek | HB-071, HB-074, HB-029, HB-008 | ADR-014; api.md §3.4; BR-BOOK-04, BR-BOOK-07, BR-INV-02, BR-INV-03 | 200 giữ cùng đơn vị qua **API** chỉ 1 thắng (bản API của US-INF-02) |
| HB-077 | UC + endpoint `POST /bookings` + `confirm`: tiêu thụ quote một lần, snapshot ORIGINAL, cờ nghi trùng 24h | R2 | Codex (test khoá) → DeepSeek | HB-076 | ADR-014, ADR-015, ADR-016; api.md §3.2; FR-BOOK-01, FR-BOOK-05, FR-BOOK-08; UC-BOOK-01; BR-BOOK-09, BR-BOOK-16 | Một quote ↔ một booking; hết hạn không hồi sinh |
| HB-078 | Worker `q.hold-expiry` thật: EXPIRED + giải phóng + audit + outbox cùng transaction; đối chiếu 900 giây | R2 | Codex (test khoá) → DeepSeek | HB-006, HB-076 | ADR-014; BR-INV-04, BR-BOOK-08, BR-BOOK-18; NFR-REL-02; TC-INV-04 | Hold hết hạn giải phóng ≤ 60 giây kể cả mất Redis |
| HB-079 | BFF customer-web cho journey khách + API giả E2E (availability/quote/booking/hold) | R2 | Codex | HB-019, HB-070 | QĐ-03 quyết định 1; ADR-018 | E2E cũ vẫn xanh |
| HB-080 | SCR-01 trang chủ & tìm phòng (customer web) | R1 | DeepSeek | HB-079, HB-075 | SCR-01; UC-INV-02 | axe sạch; 360 px |
| HB-081 | SCR-02 kết quả + SCR-03 chi tiết phòng & giá từng đêm | R1 | DeepSeek | HB-080 | SCR-02, SCR-03; BR-RATE-17; TC-RATE-21 | Giá từng đêm khớp `PriceQuote` |
| HB-082 | SCR-04 chọn gói + SCR-05 thông tin khách & xác nhận (≤ 4 bước) | R1 | DeepSeek | HB-081 | SCR-04, SCR-05; UC-BOOK-01; BR-RATE-19, BR-BOOK-16; NFR-USE-05 | Hiển thị cờ nghi trùng |
| HB-083 | SCR-07 kết quả đặt & đếm ngược giữ chỗ (theo `expiresAt` máy chủ) | R1 | DeepSeek | HB-082 | SCR-07; UC-BOOK-04; TC-BOOK-28 | Hết hạn khoá nút xác nhận |
| HB-084 | Nền journey customer Android (deep link, điều hướng) | R1 | DeepSeek | HB-070, HB-024 | SCR-72; ADR-018; NFR-USE-03 | Tải ≤ 5 giây trên 3G |
| HB-085 | SCR-72 + SCR-73 tìm phòng (customer Android) | R1 | DeepSeek | HB-084, HB-075 | SCR-72, SCR-73; UC-INV-02 | Offline theo §8.3 |
| HB-086 | SCR-74 + SCR-75 chi tiết & gói giá (customer Android) | R1 | DeepSeek | HB-085 | SCR-74, SCR-75; TC-RATE-21 | Giá khớp API + web |
| HB-087 | SCR-76 + SCR-78 xác nhận & giữ chỗ (customer Android) | R1 | DeepSeek | HB-086 | SCR-76, SCR-78; UC-BOOK-04 | Đồng hồ theo `expiresAt` máy chủ |
| HB-088 | QA F4: Playwright 2 web, Maestro Android, axe | R0 | Gemini | HB-080…HB-087 | TC-BOOK-16, TC-BOOK-17, TC-RATE-21, TC-BOOK-28 | 4 ca cổng chạy được |
| HB-089 | Nghiệm thu F4 (mốc M5) | — | lead | HB-088 | lộ trình §7.6 | Bằng chứng đủ |

## F5 — thanh toán, huỷ/hoàn, đổi ngày, đơn của tôi (cả 4 bề mặt)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| HB-090 | Hợp đồng F5: payments, online, status, balance, refund-requests (+approve/reject/cancel/pay), cancel-preview, cancel, reschedule, `DELETE /bookings/{id}` + 12 mã `E_PAY_*`/`E_CANCEL_*`/`E_BOOK_*` | R2 | DeepSeek | HB-070 | api.md §2.5, §2.6, §3.3, §3.5–§3.7 | 0 phá vỡ |
| HB-091 | Migration tiến F5 nếu §3 thiếu (payments, refund, inbox, outbox, deliveries) | R2 | Codex | HB-071 | csdl §3; ADR-016, ADR-017; BR-CANCEL-05, BR-PAY-03 | Unique `(provider, providerTxnId)` tồn tại |
| ~~HB-092~~ | Gộp vào HB-053 (engine huỷ) | — | — | — | — | — |
| HB-093 | Ledger `booking_charges`/`payment_allocations`; `balanceDue` projection; hoàn ≤ thu dưới khoá | R2 | Codex (test khoá) → DeepSeek | HB-091 | ADR-015, ADR-016; BR-PAY-02 | Không cộng REFUND/COMPENSATION như tiền thu |
| HB-094 | Adapter VNPay/MoMo + `POST /payments/online`, `GET /payments/{id}/status`; giả lập cùng hợp đồng khi chưa có sandbox | R2 | Codex (test khoá) → DeepSeek | HB-090, HB-029, HB-077 | ADR-016; api.md §3.5; FR-PAY-03, FR-PAY-04; UC-PAY-02; BR-PAY-01…05 | Lệch tiền → `E_PAY_AMOUNT_MISMATCH`; không lưu dữ liệu thẻ |
| HB-095 | Webhook inbox **PSP** (§5.2): verify chữ ký trước dedup, inbox bền trước ACK, callback muộn không hạ trạng thái. Nhánh OTA ở HB-128 | R2 | Codex (test khoá) → DeepSeek | HB-094, HB-091 | ADR-017; api.md §5.2; BR-PAY-03, BR-PAY-09, BR-PAY-11; NFR-SEC-05; TC-PAY-22 | Callback trùng không tạo Payment thứ hai; DB lỗi không ACK thành công |
| HB-096 | `POST /payments` tại quầy + `GET /bookings/{id}/balance`, đòi `pinToken`. **Dùng cho cả F7** | R2 | Codex (test khoá) → DeepSeek | HB-093, HB-094, HB-015 | api.md §2.6; FR-PAY-05, FR-PAY-06; UC-PAY-01, UC-PAY-03; BR-PAY-01, BR-PAY-02, BR-PAY-06; TC-FO-06 | CONFIRMED chỉ khi đủ cọc; thiếu PIN → `E_AUTH_PIN_REQUIRED` |
| HB-097 | `cancel-preview` + `cancel` (toàn phần/một phần) dùng policy snapshot, tạo RefundRequest + reservation | R2 | Codex (test khoá) → DeepSeek | HB-053, HB-093, HB-029 | ADR-015, ADR-016; api.md §3.3; FR-BOOK-13; UC-BOOK-08; BR-BOOK-11, BR-BOOK-14; TC-BOOK-27 | Hai lần huỷ không tái dùng tiền |
| HB-098 | `reschedule` + xoá cứng DRAFT/HELD | R2 | Codex (test khoá) → DeepSeek | HB-053, HB-077 | ADR-015; FR-BOOK-12; UC-BOOK-06; BR-BOOK-12, BR-BOOK-13, BR-BOOK-17, BR-CANCEL-08 | Giữ ORIGINAL bất biến; giá giảm không sinh hoàn |
| HB-099 | Maker-checker hoàn tiền: request/approve/reject/cancel, cấm tự duyệt mọi mức, reserve từ PENDING | R2 | Codex (test khoá) → DeepSeek | HB-093, HB-097, HB-015, HB-029 | ADR-016; api.md §3.6, §3.7; UC-PAY-04; BR-CANCEL-15…18, BR-PAY-07; TC-PAY-23 | Tự duyệt → `E_PAY_SELF_APPROVAL`; hai yêu cầu 80% cùng nguồn chỉ một được reserve |
| HB-100 | Worker chi hoàn: operation bền, đối soát trước retry, timeout không trả reservation | R2 | Codex (test khoá) → DeepSeek | HB-099, HB-095, HB-006 | ADR-016; UC-PAY-04; BR-CANCEL-12, BR-PAY-08, BR-PAY-09 | Crash sau PSP thành công không chi lần hai |
| HB-101 | SCR-06 thanh toán trực tuyến (customer web) | R1 | DeepSeek | HB-079, HB-094 | SCR-06; UC-PAY-02; TC-PAY-22 | Đọc lại trạng thái sau redirect |
| HB-102 | SCR-09 + SCR-10 đơn của tôi (customer web) | R1 | DeepSeek | HB-079, HB-098 | SCR-09, SCR-10; UC-BOOK-07 | Snapshot từng đêm + payment |
| HB-103 | SCR-11 huỷ & tiền hoàn (customer web) | R1 | DeepSeek | HB-102, HB-097 | SCR-11; UC-BOOK-08; TC-SYS-10 | Có bước xem trước; khoá khi đang tính |
| HB-104 | SCR-12 đổi ngày (customer web) | R1 | DeepSeek | HB-102, HB-098 | SCR-12; UC-BOOK-06; BR-BOOK-12 | Hiện chênh lệch + phí |
| HB-105 | SCR-13 hồ sơ khách & điểm (customer web) — cắt được | R1 | DeepSeek | HB-102 | SCR-13; UC-CRM-01, UC-CRM-02 | — |
| HB-106 | SCR-31 + SCR-32 danh sách & chi tiết booking (operations web) | R1 | DeepSeek | HB-020, HB-098 | SCR-31, SCR-32; UC-BOOK-07; BR-BOOK-17, BR-RBAC-02 | Phân trang máy chủ |
| HB-107 | SCR-33 + SCR-34 tạo booking tại quầy / qua điện thoại | R1 | DeepSeek | HB-106, HB-077 | SCR-33, SCR-34; FR-BOOK-02, FR-BOOK-03; UC-BOOK-02, UC-BOOK-03 | ≤ 5 bước tại quầy |
| HB-108 | SCR-35 + SCR-36 sửa/đổi ngày/huỷ (operations web) | R1 | DeepSeek | HB-106, HB-097, HB-098 | SCR-35, SCR-36; UC-BOOK-05, UC-BOOK-06, UC-BOOK-08 | Xác nhận hai bước |
| HB-109 | SCR-37 thu cọc/thu số dư tại quầy | R1 | DeepSeek | HB-106, HB-096 | SCR-37; UC-PAY-01, UC-PAY-03 | Đòi PIN; in biên lai |
| HB-110 | SCR-38 yêu cầu & duyệt hoàn tiền | R1 | DeepSeek | HB-106, HB-099, HB-100 | SCR-38; UC-PAY-04; TC-PAY-23 | Không có nút "chi lại"; PAID chỉ sau bằng chứng |
| HB-111 | SCR-39 đối soát + SCR-69 | R1 | DeepSeek | HB-109 | SCR-39, SCR-69; UC-PAY-05; BR-PAY-06, BR-PAY-10 | Đối soát theo (người thu, ngày VN) |
| HB-112 | SCR-77 thanh toán (customer Android) | R1 | DeepSeek | HB-084, HB-094 | SCR-77; UC-PAY-02; TC-PAY-22 | Deep link PSP an toàn |
| HB-113 | SCR-79 + SCR-80 đơn của tôi (customer Android) | R1 | DeepSeek | HB-084, HB-098 | SCR-79, SCR-80; UC-BOOK-07 | Offline §8.3 |
| HB-114 | SCR-81 + SCR-82 huỷ & đổi ngày (customer Android) | R1 | DeepSeek | HB-113, HB-097, HB-098 | SCR-81, SCR-82; UC-BOOK-06, UC-BOOK-08 | Offline không xác nhận tài chính |
| HB-115 | SCR-83 hồ sơ khách (customer Android) — cắt được | R1 | DeepSeek | HB-113 | SCR-83; UC-CRM-01 | — |
| HB-116 | API giả E2E F5 (callback muộn, timeout) | R2 | Codex | HB-079, HB-090 | api.md §5.2; TC-PAY-22, TC-BOOK-28 | E2E cũ vẫn xanh |
| HB-117 | QA F5: 2 web + 2 Android, callback PSP, maker-checker | R0 | Gemini | HB-101…HB-116 | TC-BOOK-23, TC-BOOK-27, TC-PAY-22, TC-PAY-23, TC-SYS-10 | Không hiển thị dữ liệu thẻ |
| HB-118 | Nghiệm thu F5 (mốc M6) | — | lead | HB-117 | lộ trình §7.7 | Bằng chứng đủ |
| HB-119 | Dự phòng tách ticket | — | lead cấp | — | — | — |

## Khoảng trống tài liệu

1. Hold web 20 phút nhưng timeout thanh toán trực tuyến 15 phút — chốt hiển thị SCR-06/SCR-07 khi hold còn mà payment đã timeout (ADR-014/016: bắt đầu thanh toán không gia hạn hold).
2. SCR-69 chưa rõ tiêu đề trong catalogue — xác nhận khi viết HB-111.
3. HB-095 chỉ làm nhánh PSP; nhánh OTA (api.md §5.1) thuộc HB-128, dùng chung bảng inbox.
4. BR-CANCEL-15 "hai cấp" nghĩa là người lập + người duyệt độc lập (ADR-016), không phải MANAGER → OWNER.
