# 04 — Cơ sở dữ liệu

> Thiết kế CSDL vật lý cho hệ thống đặt phòng – homestay chuỗi Pine Hill: **3 cơ sở · 55 phòng · 75 đơn vị bán · 7 kênh bán · 13 module**.
> CSDL mục tiêu **PostgreSQL 16** (ADR-003): Prisma 6 sinh phần thân bảng, **migration SQL thủ công** cho ràng buộc loại trừ, cột sinh, chỉ mục biểu thức và trigger.
> Định danh thực thể/enum: [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh) · Quy tắc nghiệp vụ: [02/quy-tắc-nghiệp-vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) (**136 BR**).
> DDL trong tài liệu này **đã chạy thành công trên PostgreSQL 16**, kèm **41 kịch bản kiểm chứng ràng buộc** và **5 truy vấn then chốt** ở §9.
> Nguồn duy nhất của mọi giá trị số là file BR — tài liệu này chỉ **tham chiếu mã BR**.

---

## 1. Quy ước thiết kế CSDL

| # | Quy ước | Ghi chú |
|---|---------|---------|
| 1 | Tên bảng `snake_case` **số nhiều**; cột là `snake_case` của trường `camelCase` trong [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh) | `channelPolicyCode` → `channel_policy_code` |
| 2 | Khoá chính **UUID** (`gen_random_uuid()`); mọi quan hệ đều có **khoá ngoại** | Không lộ số lượng bản ghi; hợp nhất dữ liệu đa nguồn |
| 3 | Mọi bảng có `created_at`/`updated_at` kiểu `timestamptz`, **lưu UTC** | BR-GEN-02, NFR-LOC-02; `updated_at` tự cập nhật bằng trigger |
| 4 | **Tiền = `bigint` VND**, không dùng số thực | BR-GEN-01, NFR-LOC-03; phần trăm dùng `numeric(5,2)` |
| 5 | Enum lưu dạng `text` + `CHECK (… IN (…))`, **không** dùng kiểu `ENUM` của PostgreSQL | Thêm giá trị = migration thường; triển khai cuốn chiếu không bị khoá `ALTER TYPE` |
| 6 | Ngày dùng `date`, thời điểm `timestamptz`, khoảng ngày `daterange` **nửa mở `[start, end)`** | BR-GEN-04; nửa mở để đêm liền kề không chồng lấn (§4) |
| 7 | Đơn vị tồn phòng là **`(room_id, bed_no)`**: `bed_no = 0` = cả phòng, `1..bedCount` = giường (chỉ DOR) | BR-INV-03, BR-PROP-04; 55 phòng = **75 đơn vị bán** (BR-PROP-03) |
| 8 | Bất biến ép được ở CSDL thì **ép ở CSDL** (`EXCLUDE`/`CHECK`/`UNIQUE`/cột sinh/trigger) | BR-INV-02/03, NFR-REL-01/05 |
| 9 | Bảng append-only bị thu hồi quyền ghi ở tầng CSDL | BR-SYS-01, NFR-SEC-04 (§7) |
| 10 | Mọi thao tác ghi mang `Idempotency-Key` → bảng `idempotency_keys` (24 giờ) và cột `UNIQUE` nơi cần | BR-GEN-08, BR-PAY-03 |
| 11 | **Không** lưu dữ liệu thẻ (số thẻ, hết hạn, CVV) | BR-PAY-04, NFR-SEC-02 |
| 12 | `audit_logs.entity_id` **không** là khoá ngoại | BR-BOOK-17: xoá cứng booking vẫn giữ được vết nhật ký |
| 13 | `outbox_events` chống lưng cho cổng ra `OutboxPort`; nhật ký và sự kiện ghi trong **cùng transaction** `UnitOfWork` | BR-GEN-07, BR-CHAN-06 · [04/kiến-trúc](kien-truc.md) |

### 1.1. Ghi chú kiểu dữ liệu quyết định

| Cột | Kiểu | Vì sao |
|-----|------|--------|
| `room_assignments.bed_no` | `smallint NOT NULL DEFAULT 0` | BR-INV-03: đơn vị bán là (phòng, giường). `0` = cả phòng, `1..bedCount` = giường (chỉ DOR — BR-PROP-04, `MERGE_SHARE`) |
| `room_assignments.valid_range` | `daterange GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED` | Khoá loại trừ cần kiểu khoảng có chỉ mục GiST (§4) |
| `bookings.nights` | `smallint GENERATED ALWAYS AS ((check_out - check_in)::smallint) STORED` | BR-BOOK-03: số đêm suy ra từ khoảng ngày |
| `bookings.seq` | `bigint NOT NULL DEFAULT nextval('bookings_seq') UNIQUE` | BR-OVER-11: phá hoà cuối khi xếp khách điều chuyển, tăng đơn điệu (UUID không có thứ tự) |
| `bookings.balance_due` | cột sinh theo `status` | BR-PAY-02: booking `CANCELLED`/`NO_SHOW`/`EXPIRED` chỉ còn nợ `penalty_amount` |
| `payments.amount` | `bigint` **có dấu** | BR-PAY-09: bút toán `REFUND` ghi âm để doanh thu thuần cộng trực tiếp |
| `rate_calendars.priority` | `smallint` + `CHECK` khớp `source` | BR-RATE-02: `OVERRIDE` 100 → `RATE_PLAN` 90 → `SEASON` 50 → `BASE` 10 |
| `rate_calendars.channel_code` | `text NULL` (FK `channels.code`) | BR-RATE-02: dòng khai kênh chỉ áp cho kênh đó; `NULL` = mọi kênh |
| `cancellation_policies.early_checkout_free_hours` / `early_checkout_refund_pct` | `smallint NULL` / `numeric(5,2)` | BR-CANCEL-09: ngưỡng trả phòng sớm phải là **dữ liệu**, không hard-code trong `CancellationPolicyEngine` |
| `price_snapshots.seq`, `kind` | `smallint` / `text` | BR-RATE-16, BR-CANCEL-19: giữ bản gốc và các bản điều chỉnh (`RESCHEDULE`, `PARTIAL_CANCEL`) |
| `price_snapshots.channel_property_setting_id` | FK | BR-RATE-18: ghi lại dòng `ChannelPropertySetting` đã chọn (theo `effectiveFrom` của từng đêm) để tái lập kết quả |
| `refund_requests.reason` | enum `CancelReason` | Ràng buộc theo enum, không phải chuỗi tự do (BR-CANCEL-13/18/19) |
| `refund_requests.net_refund` | cột sinh `coalesce(approved_amount, requested_amount) − refund_fee` | BR-CANCEL-05: mọi ngưỡng phê duyệt và báo cáo so trên **`netRefund`** |
| `guests.phone` | `text` + `UNIQUE` từng phần | BR-CRM-01: nhận diện khách theo SĐT chuẩn hoá `+84…` (NFR-LOC-04) |
| `bookings.external_ref` | `text` + `UNIQUE (channel_id, external_ref)` | BR-CHAN-03/04: đối soát booking OTA, chặn webhook gửi lại tạo bản ghi mới |

### 1.2. Hai bản ghi **không** nằm trong PostgreSQL

| Thực thể | Nơi lưu | Vì sao | Nguồn chân lý |
|----------|---------|--------|---------------|
| `PriceQuote` | Redis 7, khoá `quote:<quoteId>`, TTL **900 giây** | Hiệu lực 15 phút rồi phải tính lại (BR-RATE-15). Trường lưu: `id`, `propertyId`, `roomTypeId`, `ratePlanCode`, `channelCode`, `checkIn`, `checkOut`, `nights[]` (mỗi phần tử có `basePrice`, các hệ số, `clamped`, `nightlyPrice`), `subtotal`, `discountAmount`, `total`, `depositAmount`, `currency`, `quotedAt`, `expiresAt`, `warnings[]` (BR-RATE-12 đường báo giá trực tuyến) | Bản ghi bất biến khi booking rời `DRAFT` là `price_snapshots` (BR-RATE-16) |
| `Hold` | Redis 7, khoá `hold:<bookingId>`: `id`, `bookingId`, `channelId`, `expiresAt`, `status` (`ACTIVE`/`RELEASED`/`EXPIRED`), `releasedAt` | Bộ đếm nhanh của đường giữ chỗ; job giải phóng mỗi 30 giây (`job.hold.releaseIntervalSeconds`) và job đối chiếu mỗi 900 giây (`job.holdReconcile.intervalSeconds`) phát hiện hold treo | **`bookings.hold_expires_at`** — mọi truy vấn tồn phòng đọc từ đây, không đọc Redis (BR-INV-04, NFR-REL-02) |

---

## 2. Sơ đồ ERD

### 2.1. Nhóm A — Định danh, cơ sở, giá & kênh bán

```mermaid
erDiagram
  USERS ||--o{ USER_PROPERTY_SCOPES : "được gán"
  PROPERTIES ||--o{ USER_PROPERTY_SCOPES : "thuộc phạm vi"
  PROPERTIES ||--o{ ROOM_TYPES : "có loại phòng"
  PROPERTIES ||--o{ ROOMS : "có phòng"
  ROOM_TYPES ||--o{ ROOMS : "phân loại"
  ROOMS ||--o{ ROOM_BLOCKS : "bị khoá"
  ROOMS ||--o{ HOUSEKEEPING_TASKS : "được dọn"
  USERS ||--o{ ROOM_BLOCKS : "tạo khoá"
  USERS ||--o{ HOUSEKEEPING_TASKS : "được giao"
  PROPERTIES ||--o{ SEASONS : "áp mùa"
  ROOM_TYPES ||--o{ RATE_CALENDARS : "có lịch giá"
  PROPERTIES ||--o{ RATE_CALENDARS : "cấu hình giá"
  SEASONS ||--o{ RATE_CALENDARS : "sinh giá mùa"
  CHANNELS ||--o{ RATE_CALENDARS : "ghi đè theo kênh"
  CHANNELS ||--o{ CHANNEL_PROPERTY_SETTINGS : "cấu hình theo cơ sở"
  PROPERTIES ||--o{ CHANNEL_PROPERTY_SETTINGS : "áp riêng"
  CHANNELS ||--o{ CHANNEL_MAPPINGS : "ánh xạ mã phòng"
  ROOM_TYPES ||--o{ CHANNEL_MAPPINGS : "được ánh xạ"
  CANCELLATION_POLICIES ||--o{ CANCELLATION_TIERS : "gồm bậc"
  CANCELLATION_POLICIES ||--o{ RATE_PLANS : "áp cho gói giá"
  CHANNELS ||--o{ CHANNEL_ALLOTMENTS : "được phân bổ"
  ROOM_TYPES ||--o{ CHANNEL_ALLOTMENTS : "theo loại phòng"

  USERS {
    uuid id PK
    text username UK
    text role
    smallint failed_login_count
  }
  USER_PROPERTY_SCOPES {
    uuid id PK
    uuid user_id FK
    uuid property_id FK
  }
  PROPERTIES {
    uuid id PK
    text code UK
    numeric overbook_limit_pct
  }
  ROOM_TYPES {
    uuid id PK
    uuid property_id FK
    text code
    bigint base_price
    bigint min_price
    bigint max_price
    boolean allow_shared
  }
  ROOMS {
    uuid id PK
    uuid property_id FK
    uuid room_type_id FK
    uuid connecting_room_id FK
    smallint bed_count
    text status
  }
  ROOM_BLOCKS {
    uuid id PK
    uuid room_id FK
    uuid created_by FK
    date start_date
    date end_date
  }
  HOUSEKEEPING_TASKS {
    uuid id PK
    uuid room_id FK
    uuid assigned_to FK
    date business_date
    text status
  }
  CANCELLATION_POLICIES {
    uuid id PK
    text code UK
    smallint early_checkout_free_hours
    numeric early_checkout_refund_pct
  }
  CANCELLATION_TIERS {
    uuid id PK
    uuid policy_id FK
    integer offset_hours
    numeric refund_percent
    boolean charge_first_night
  }
  RATE_PLANS {
    uuid id PK
    text code UK
    uuid cancellation_policy_id FK
    numeric deposit_percent
    bigint fixed_nightly_price
  }
  SEASONS {
    uuid id PK
    uuid property_id FK
    text code
    date start_date
    date end_date
    numeric multiplier
    smallint priority
  }
  RATE_CALENDARS {
    uuid id PK
    uuid room_type_id FK
    uuid property_id FK
    uuid season_id FK
    text channel_code FK
    date date
    text source
    smallint priority
  }
  CHANNELS {
    uuid id PK
    text code UK
    numeric commission_pct
    text sync_status
    text status
  }
  CHANNEL_PROPERTY_SETTINGS {
    uuid id PK
    uuid channel_id FK
    uuid property_id FK
    numeric commission_pct
    date effective_from
  }
  CHANNEL_MAPPINGS {
    uuid id PK
    uuid channel_id FK
    uuid room_type_id FK
    text external_room_code
    text status
  }
  CHANNEL_ALLOTMENTS {
    uuid id PK
    uuid channel_id FK
    uuid room_type_id FK
    date date
    smallint allotment
    smallint used
  }
  PROMOTIONS {
    uuid id PK
    text code UK
    text type
    numeric value
    text_array channel_scope
  }
```

### 2.2. Nhóm B — Khách hàng, đặt phòng & đơn vị bán theo đêm

```mermaid
erDiagram
  %% HOLD là bản ghi phụ trợ ở Redis; nguồn chân lý là BOOKINGS.hold_expires_at (00 §7.3).
  %% PRICE_QUOTES là bản ghi tạm 15 phút ở Redis (BR-RATE-15).
  GUESTS ||--o{ BOOKINGS : "đặt"
  GUESTS ||--o{ GUEST_NOTES : "có ghi chú"
  GUESTS ||--o{ LOYALTY_TRANSACTIONS : "tích điểm"
  CHANNELS ||--o{ BOOKINGS : "nhận đặt"
  PROPERTIES ||--o{ BOOKINGS : "phục vụ"
  RATE_PLANS ||--o{ BOOKINGS : "theo gói giá"
  BOOKINGS ||--o{ BOOKING_ROOMS : "gồm phòng/giường"
  BOOKINGS ||--o{ BOOKING_STATUS_HISTORY : "ghi vết trạng thái"
  BOOKINGS ||--o{ PRICE_SNAPSHOTS : "chốt giá theo lần"
  BOOKINGS ||--o{ LOYALTY_TRANSACTIONS : "sinh điểm"
  ROOM_TYPES ||--o{ BOOKING_ROOMS : "loại phòng bán"
  BOOKING_ROOMS ||--o{ ROOM_ASSIGNMENTS : "gán đơn vị bán"
  ROOMS ||--o{ ROOM_ASSIGNMENTS : "được gán"
  CHANNEL_PROPERTY_SETTINGS ||--o{ PRICE_SNAPSHOTS : "được ghi vào"
  BOOKINGS ||--o{ HOLDS : "có hold (Redis)"
  CHANNELS ||--o{ HOLDS : "giữ chỗ"

  GUESTS {
    uuid id PK
    text full_name
    text phone UK
    text gender
    text loyalty_tier
  }
  GUEST_NOTES {
    uuid id PK
    uuid guest_id FK
    uuid author_id FK
  }
  LOYALTY_TRANSACTIONS {
    uuid id PK
    uuid guest_id FK
    uuid booking_id FK
    integer points
    text type
  }
  BOOKINGS {
    uuid id PK
    text code UK
    bigint seq UK
    uuid guest_id FK
    uuid property_id FK
    uuid room_type_id FK
    uuid rate_plan_id FK
    uuid channel_id FK
    text status
    smallint room_count
    smallint nights
    bigint balance_due
    boolean duplicate_suspected
    smallint reschedule_count
    text channel_policy_code
    timestamptz hold_expires_at
  }
  BOOKING_ROOMS {
    uuid id PK
    uuid booking_id FK
    uuid room_type_id FK
    bigint price_per_night
    text status
    timestamptz cancelled_at
  }
  ROOM_ASSIGNMENTS {
    uuid id PK
    uuid booking_room_id FK
    uuid room_id FK
    smallint bed_no
    date start_date
    date end_date
    daterange valid_range
    timestamptz released_at
  }
  BOOKING_STATUS_HISTORY {
    uuid id PK
    uuid booking_id FK
    uuid actor_id FK
    text to_status
  }
  PRICE_SNAPSHOTS {
    uuid id PK
    uuid booking_id FK
    smallint seq
    text kind
    text engine_version
    uuid channel_property_setting_id FK
  }
  HOLDS {
    uuid id PK
    uuid booking_id FK
    uuid channel_id FK
    timestamptz expires_at
    text status
  }
  PRICE_QUOTES {
    uuid id PK
    uuid room_type_id FK
    timestamptz expires_at
  }
```

### 2.3. Nhóm C — Quá tải, thanh toán & hệ thống

```mermaid
erDiagram
  PROPERTIES ||--o{ OVERBOOKING_CASES : "phát sinh"
  ROOM_TYPES ||--o{ OVERBOOKING_CASES : "thiếu phòng"
  BOOKINGS ||--o{ ROOM_MOVES : "được điều chuyển"
  BOOKING_ROOMS ||--o{ ROOM_MOVES : "đổi đơn vị"
  ROOMS ||--o{ ROOM_MOVES : "điểm đi/đến"
  USERS ||--o{ ROOM_MOVES : "duyệt"
  BOOKINGS ||--o{ ROOM_MERGES : "ghép chính"
  BOOKINGS ||--o{ ROOM_MERGES : "ghép phụ"
  ROOMS ||--o{ ROOM_MERGES : "ghép tại"
  BOOKINGS ||--o{ PAYMENTS : "thanh toán"
  USERS ||--o{ PAYMENTS : "thu tiền"
  BOOKINGS ||--o{ REFUND_REQUESTS : "yêu cầu hoàn"
  PAYMENTS ||--o{ REFUND_REQUESTS : "hoàn cho giao dịch"
  CANCELLATION_POLICIES ||--o{ REFUND_REQUESTS : "theo chính sách"
  CANCELLATION_TIERS ||--o{ REFUND_REQUESTS : "áp bậc"
  USERS ||--o{ REFUND_REQUESTS : "tạo/duyệt"
  BOOKINGS ||--o{ NOTIFICATIONS : "thông báo"
  USERS ||--o{ AUDIT_LOGS : "hành động"
  USERS ||--o{ IDEMPOTENCY_KEYS : "gửi yêu cầu"
  CHANNELS ||--o{ OUTBOX_EVENTS : "đồng bộ tới"
  PROPERTIES ||--o{ OCCUPANCY_SNAPSHOTS : "đo công suất"
  ROOM_TYPES ||--o{ OCCUPANCY_SNAPSHOTS : "theo loại phòng"

  OVERBOOKING_CASES {
    uuid id PK
    uuid property_id FK
    uuid room_type_id FK
    date date
    smallint shortage_count
    text status
    timestamptz escalated_at
    text delay_reason
  }
  ROOM_MOVES {
    uuid id PK
    uuid booking_id FK
    uuid booking_room_id FK
    uuid from_room_id FK
    uuid to_room_id FK
    text move_type
    smallint keep_score
    boolean price_locked
    bigint compensation_amount
    text walk_out_doc_no
  }
  ROOM_MERGES {
    uuid id PK
    uuid primary_booking_id FK
    uuid secondary_booking_id FK
    uuid room_id FK
    boolean consent_primary
    boolean consent_secondary
    bigint discount_amount
    text status
  }
  PAYMENTS {
    uuid id PK
    uuid booking_id FK
    uuid created_by FK
    text type
    text method
    bigint amount
    text idempotency_key UK
  }
  REFUND_REQUESTS {
    uuid id PK
    uuid booking_id FK
    uuid payment_id FK
    uuid policy_id FK
    uuid applied_tier_id FK
    uuid requested_by FK
    uuid approved_by FK
    text status
    text reason
    bigint net_refund
  }
  NOTIFICATIONS {
    uuid id PK
    uuid booking_id FK
    text channel
    text status
    smallint retry_count
  }
  AUDIT_LOGS {
    uuid id PK
    uuid actor_id FK
    text actor_role
    text entity_type
    uuid entity_id
    text prev_hash
    text row_hash
  }
  IDEMPOTENCY_KEYS {
    uuid id PK
    text key UK
    uuid actor_id FK
    text request_hash
    timestamptz expires_at
  }
  SYSTEM_SETTINGS {
    uuid id PK
    text key UK
    text value_type
    uuid updated_by FK
  }
  OUTBOX_EVENTS {
    uuid id PK
    uuid channel_id FK
    text event_type
    text status
  }
  OCCUPANCY_SNAPSHOTS {
    uuid id PK
    uuid property_id FK
    uuid room_type_id FK
    date date
    smallint physical_rooms
    smallint sold_rooms
    numeric occupancy_pct
  }
```

---

## 3. DDL PostgreSQL 16

Thứ tự khối lệnh là **thứ tự phụ thuộc khoá ngoại** (bảng không phụ thuộc tạo trước), không phải thứ tự nhóm module: `loyalty_transactions` đặt sau `bookings`, khối ràng buộc/trigger/chỉ mục/quyền đặt sau cùng.

### 3.1. Phần nền: extension, sequence, hàm ngữ cảnh phiên

```sql
-- PostgreSQL 16 — đồ án Pine Hill Homestay
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- kiểu chỉ mục gist cho uuid/smallint (ràng buộc loại trừ)
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- digest() SHA-256 cho chuỗi băm AuditLog

-- Ngữ cảnh phiên, ứng dụng đặt trong mỗi transaction ghi:
--   SET LOCAL app.actor_id = '<uuid>';  SET LOCAL app.actor_role = 'MANAGER';
CREATE OR REPLACE FUNCTION fn_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('app.actor_role', true), 'ANONYMOUS')
$$;

CREATE SEQUENCE IF NOT EXISTS bookings_seq;  -- BR-OVER-11: phá hoà theo thứ tự tăng đơn điệu
```

### 3.2. Bảng theo nhóm module

#### 3.2.1. AUTH+PROP — Người dùng, cơ sở & buồng phòng

```sql
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username           text NOT NULL UNIQUE,
  password_hash      text NOT NULL,
  full_name          text NOT NULL,
  role               text NOT NULL CHECK (role IN ('OWNER','MANAGER','FRONT_DESK','RESERVATION_AGENT','ACCOUNTANT','HOUSEKEEPING')),
  phone              text,
  is_active          boolean NOT NULL DEFAULT true,
  failed_login_count smallint NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until       timestamptz,
  last_login_at      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  address             text NOT NULL,
  phone               text NOT NULL,
  check_in_time       time NOT NULL DEFAULT '14:00',
  check_out_time      time NOT NULL DEFAULT '12:00',
  timezone            text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  overbook_limit_pct  numeric(4,2) NOT NULL DEFAULT 0,
  latitude            numeric(9,6) NOT NULL,
  longitude           numeric(9,6) NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_properties_overbook_pct CHECK (overbook_limit_pct >= 0 AND overbook_limit_pct <= 5)
);

CREATE TABLE room_types (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  code              text NOT NULL CHECK (code IN ('STD','SUP','DLX','FAM','DOR')),
  name              text NOT NULL,
  capacity_adults   smallint NOT NULL CHECK (capacity_adults > 0),
  capacity_children smallint NOT NULL DEFAULT 0 CHECK (capacity_children >= 0),
  base_price        bigint NOT NULL CHECK (base_price > 0),
  min_price         bigint NOT NULL CHECK (min_price > 0),
  max_price         bigint NOT NULL CHECK (max_price > 0),
  allow_shared      boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_room_types_property_code UNIQUE (property_id, code),
  CONSTRAINT ck_room_types_price_band CHECK (min_price <= base_price AND base_price <= max_price),
  CONSTRAINT ck_room_types_shared_only_dor CHECK (NOT allow_shared OR code = 'DOR')
);

CREATE TABLE rooms (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  room_type_id        uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  name                text NOT NULL,
  floor               smallint NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE')),
  connecting_room_id  uuid REFERENCES rooms(id) ON DELETE SET NULL,
  bed_count           smallint NOT NULL DEFAULT 1 CHECK (bed_count >= 1),   -- BR-PROP-04: DOR = 6, còn lại = 1
  note                text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rooms_property_code UNIQUE (property_id, code),
  CONSTRAINT ck_rooms_not_self_connecting CHECK (connecting_room_id IS NULL OR connecting_room_id <> id)
);

CREATE TABLE user_property_scopes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_property_scopes UNIQUE (user_id, property_id)
);

CREATE TABLE room_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('MAINTENANCE','RENOVATION','OWNER_USE','DEEP_CLEAN')),
  created_by  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_blocks_range CHECK (end_date > start_date)
);

CREATE TABLE housekeeping_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','DONE','INSPECTED')),
  assigned_to   uuid REFERENCES users(id) ON DELETE SET NULL,
  note          text,
  completed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_housekeeping_room_date UNIQUE (room_id, business_date)
);
```

#### 3.2.2. RATE — Giá, mùa & kênh bán

```sql
CREATE TABLE cancellation_policies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  early_checkout_free_hours smallint CHECK (early_checkout_free_hours IS NULL OR early_checkout_free_hours >= 0),
  early_checkout_refund_pct numeric(5,2) NOT NULL DEFAULT 0
                     CHECK (early_checkout_refund_pct >= 0 AND early_checkout_refund_pct <= 100),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cancellation_tiers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE CASCADE,
  offset_hours       integer NOT NULL CHECK (offset_hours >= -1),
  refund_percent     numeric(5,2) NOT NULL CHECK (refund_percent >= 0 AND refund_percent <= 100),
  charge_first_night boolean NOT NULL DEFAULT false,
  label              text NOT NULL,
  sort_order         smallint NOT NULL CHECK (sort_order > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cancellation_tiers_order UNIQUE (policy_id, sort_order),
  CONSTRAINT uq_cancellation_tiers_offset UNIQUE (policy_id, offset_hours)
);

CREATE TABLE rate_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code IN ('FLEX7','SAVER3','NONREF','LONGSTAY14')),
  name                text NOT NULL,
  deposit_percent     numeric(5,2) NOT NULL CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  cancellation_policy_id uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE RESTRICT,
  min_nights          smallint NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  max_nights          smallint NOT NULL DEFAULT 365,
  fixed_nightly_price bigint CHECK (fixed_nightly_price IS NULL OR fixed_nightly_price > 0),
  los_discount_enabled boolean NOT NULL DEFAULT true,
  reschedule_allowed  boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rate_plans_nights CHECK (max_nights >= min_nights)
);

CREATE TABLE channels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code              text NOT NULL UNIQUE
                    CHECK (code IN ('WEB','PHONE','WALKIN','OTA_BOOKING','OTA_AGODA','OTA_AIRBNB','AGENCY')),
  name              text NOT NULL,
  multiplier        numeric(5,3) NOT NULL CHECK (multiplier > 0),
  commission_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 50),
  hold_minutes      integer NOT NULL DEFAULT 0 CHECK (hold_minutes >= 0),
  overbook_allowed  boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  sync_status       text NOT NULL DEFAULT 'OK' CHECK (sync_status IN ('OK','DEGRADED')),
  consecutive_sync_failures smallint NOT NULL DEFAULT 0 CHECK (consecutive_sync_failures >= 0),
  last_sync_at      timestamptz,
  last_sync_error   text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE channel_property_settings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  commission_pct      numeric(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 50),
  multiplier_override numeric(5,3) CHECK (multiplier_override IS NULL OR multiplier_override > 0),
  effective_from      date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_property_settings UNIQUE (channel_id, property_id, effective_from)
);

CREATE TABLE channel_mappings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id              uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id            uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  external_room_code      text NOT NULL,
  external_rate_plan_code text,
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_mappings_room UNIQUE (channel_id, room_type_id),
  CONSTRAINT uq_channel_mappings_external UNIQUE (channel_id, external_room_code)
);

CREATE TABLE seasons (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id               uuid REFERENCES properties(id) ON DELETE CASCADE,
  code                      text NOT NULL CHECK (code IN ('SE-NY','SE-TET','SE-REUN','SE-NAT','SE-SUM','SE-SHO','SE-LOW')),
  name                      text NOT NULL,
  start_date                date NOT NULL,
  end_date                  date NOT NULL,
  multiplier                numeric(5,3) NOT NULL CHECK (multiplier > 0),
  priority                  smallint NOT NULL CHECK (priority >= 0),
  weekend_surcharge_enabled boolean NOT NULL DEFAULT true,
  status                    text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_seasons_range CHECK (end_date >= start_date),
  CONSTRAINT uq_seasons_scope_code_start UNIQUE (property_id, code, start_date)
);

CREATE TABLE rate_calendars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type_id uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date         date NOT NULL,
  price        bigint NOT NULL CHECK (price > 0),
  source       text NOT NULL DEFAULT 'BASE' CHECK (source IN ('BASE','SEASON','OVERRIDE','RATE_PLAN')),
  priority     smallint NOT NULL,
  channel_code text REFERENCES channels(code) ON DELETE CASCADE,
  season_id    uuid REFERENCES seasons(id) ON DELETE SET NULL,
  reason       text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rate_calendars_priority CHECK (
    (source = 'OVERRIDE'  AND priority = 100) OR
    (source = 'RATE_PLAN' AND priority = 90)  OR
    (source = 'SEASON'    AND priority = 50)  OR
    (source = 'BASE'      AND priority = 10)),
  CONSTRAINT ck_rate_calendars_season CHECK (source = 'SEASON' OR season_id IS NULL),
  CONSTRAINT ck_rate_calendars_reason CHECK (source <> 'OVERRIDE' OR length(coalesce(reason, '')) > 0)
);

CREATE TABLE channel_allotments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  room_type_id  uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  date          date NOT NULL,
  allotment     smallint NOT NULL CHECK (allotment >= 0),
  used          smallint NOT NULL DEFAULT 0 CHECK (used >= 0),
  is_closed     boolean NOT NULL DEFAULT false,
  closed_reason text,
  closed_at     timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_channel_allotments_scope UNIQUE (channel_id, room_type_id, date),
  CONSTRAINT ck_channel_allotments_used CHECK (used <= allotment),
  CONSTRAINT ck_channel_allotments_closed CHECK (is_closed = false OR closed_at IS NOT NULL)
);

CREATE TABLE promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,
  name             text NOT NULL,
  type             text NOT NULL CHECK (type IN ('PERCENT','AMOUNT')),
  value            numeric(12,2) NOT NULL CHECK (value > 0),
  min_nights       smallint NOT NULL DEFAULT 1 CHECK (min_nights >= 1),
  channel_scope    text[] NOT NULL DEFAULT '{}',
  room_type_scope  text[] NOT NULL DEFAULT '{}',
  valid_from       date NOT NULL,
  valid_to         date NOT NULL,
  max_uses         integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count       integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  stackable        boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_promotions_window CHECK (valid_to >= valid_from),
  CONSTRAINT ck_promotions_percent CHECK (type <> 'PERCENT' OR value <= 100),
  CONSTRAINT ck_promotions_usage CHECK (max_uses IS NULL OR used_count <= max_uses),
  CONSTRAINT ck_promotions_channels CHECK (channel_scope <@ ARRAY['WEB','PHONE','WALKIN','OTA_BOOKING','OTA_AGODA','OTA_AIRBNB','AGENCY']::text[]),
  CONSTRAINT ck_promotions_room_types CHECK (room_type_scope <@ ARRAY['STD','SUP','DLX','FAM','DOR']::text[])
);
```

#### 3.2.3. CRM — Khách hàng

```sql
CREATE TABLE guests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  phone              text NOT NULL,
  email              text,
  id_number          text,
  dob                date,
  nationality        text DEFAULT 'VN',
  loyalty_tier       text NOT NULL DEFAULT 'GUEST' CHECK (loyalty_tier IN ('GUEST','MEMBER','SILVER','GOLD','PLATINUM')),
  loyalty_points     integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  total_stays        smallint NOT NULL DEFAULT 0 CHECK (total_stays >= 0),
  blacklisted        boolean NOT NULL DEFAULT false,
  blacklist_reason   text,
  notes              text,
  gender             text NOT NULL DEFAULT 'UNSPECIFIED'
                     CHECK (gender IN ('MALE','FEMALE','OTHER','UNSPECIFIED')),
  consent_marketing  boolean NOT NULL DEFAULT false,
  consent_at         timestamptz,
  consent_version    text,
  anonymized_at      timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_guests_phone_normalized CHECK (anonymized_at IS NOT NULL OR phone ~ '^\+84[0-9]{9}$'),
  CONSTRAINT ck_guests_blacklist_reason CHECK (NOT blacklisted OR blacklist_reason IS NOT NULL)
);

CREATE TABLE guest_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  content    text NOT NULL,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
```

#### 3.2.4. BOOK — Đặt phòng & đơn vị bán theo đêm

```sql
CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE CHECK (code ~ '^PH-[0-9]{6}-[A-Z0-9]{5}$'),
  seq                bigint NOT NULL DEFAULT nextval('bookings_seq') UNIQUE,   -- BR-OVER-11: phá hoà tất định
  guest_id           uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
  property_id        uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  room_type_id       uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  rate_plan_id       uuid NOT NULL REFERENCES rate_plans(id) ON DELETE RESTRICT,
  channel_id         uuid NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  nights             smallint GENERATED ALWAYS AS ((check_out - check_in)::smallint) STORED,
  adults             smallint NOT NULL CHECK (adults > 0),
  children           smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
  status             text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','HELD','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','CHECKED_OUT','CANCELLED','NO_SHOW','EXPIRED')),
  room_count         smallint NOT NULL DEFAULT 1 CHECK (room_count > 0),
  total_amount       bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  deposit_percent    numeric(5,2) NOT NULL CHECK (deposit_percent >= 0 AND deposit_percent <= 100),
  deposit_amount     bigint NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  paid_amount        bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  refunded_amount    bigint NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  penalty_amount     bigint NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  balance_due        bigint GENERATED ALWAYS AS (
                       CASE WHEN status IN ('CANCELLED','NO_SHOW','EXPIRED') THEN penalty_amount
                            ELSE total_amount - paid_amount + penalty_amount END) STORED,
  currency           char(3) NOT NULL DEFAULT 'VND',
  hold_expires_at    timestamptz,
  oversold           boolean NOT NULL DEFAULT false,
  duplicate_suspected boolean NOT NULL DEFAULT false,
  price_locked       boolean NOT NULL DEFAULT false,
  external_ref       text,
  channel_policy_code text,
  reschedule_count   smallint NOT NULL DEFAULT 0 CHECK (reschedule_count >= 0),
  note               text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at       timestamptz,
  cancel_reason      text CHECK (cancel_reason IS NULL OR cancel_reason IN
                     ('GUEST_REQUEST','FORCE_MAJEURE','HOTEL_RELOCATION','PAYMENT_TIMEOUT','DUPLICATE','NO_SHOW',
                     'SYSTEM','OTA_CANCELLATION','EARLY_CHECKOUT')),
  CONSTRAINT ck_bookings_range CHECK (check_out > check_in),
  CONSTRAINT ck_bookings_refund_cap CHECK (refunded_amount <= paid_amount),
  CONSTRAINT ck_bookings_cancelled CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  CONSTRAINT ck_bookings_hold CHECK (status <> 'HELD' OR hold_expires_at IS NOT NULL)
);

CREATE TABLE booking_rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_type_id    uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  adults          smallint NOT NULL CHECK (adults > 0),
  children        smallint NOT NULL DEFAULT 0 CHECK (children >= 0),
  price_per_night bigint NOT NULL CHECK (price_per_night >= 0),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  cancelled_at    timestamptz,
  CONSTRAINT ck_booking_rooms_cancelled CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_room_id uuid NOT NULL REFERENCES booking_rooms(id) ON DELETE CASCADE,
  room_id         uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  bed_no          smallint NOT NULL DEFAULT 0 CHECK (bed_no >= 0),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  valid_range     daterange GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED,
  released_at     timestamptz,
  release_reason  text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_assignments_range CHECK (end_date > start_date)
);

CREATE TABLE booking_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  reason      text,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE price_snapshots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seq          smallint NOT NULL CHECK (seq > 0),
  kind         text NOT NULL DEFAULT 'ORIGINAL'
               CHECK (kind IN ('ORIGINAL','RESCHEDULE','PARTIAL_CANCEL')),
  payload_json jsonb NOT NULL,
  engine_version text NOT NULL,
  channel_property_setting_id uuid REFERENCES channel_property_settings(id) ON DELETE SET NULL,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_price_snapshots_seq UNIQUE (booking_id, seq)
);
```

#### 3.2.5. OVER — Quá tải & điều chuyển

```sql
CREATE TABLE overbooking_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
  date            date NOT NULL,
  room_type_id    uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
  shortage_count  smallint NOT NULL CHECK (shortage_count > 0),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PROPOSED','RESOLVED','ESCALATED')),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  escalated_at    timestamptz,
  delay_reason    text,
  resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_overbooking_resolved CHECK (status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CONSTRAINT ck_overbooking_escalated CHECK (status <> 'ESCALATED' OR escalated_at IS NOT NULL)
);

CREATE TABLE room_moves (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  booking_room_id  uuid NOT NULL REFERENCES booking_rooms(id) ON DELETE CASCADE,
  move_type        text NOT NULL CHECK (move_type IN
                   ('SAME_TYPE_SAME_PROPERTY','UPGRADE_SAME_PROPERTY','SAME_TYPE_CROSS_PROPERTY',
                    'UPGRADE_CROSS_PROPERTY','WALK_OUT','SPLIT_ROOMS','MERGE_SHARE','MERGE_CONNECTING')),
  from_room_id     uuid REFERENCES rooms(id) ON DELETE SET NULL,
  to_room_id       uuid REFERENCES rooms(id) ON DELETE SET NULL,
  from_property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  to_property_id   uuid REFERENCES properties(id) ON DELETE SET NULL,
  reason           text NOT NULL,
  keep_score       smallint NOT NULL DEFAULT 0 CHECK (keep_score >= 0 AND keep_score <= 173),
  price_locked     boolean NOT NULL DEFAULT true,
  compensation_amount bigint NOT NULL DEFAULT 0 CHECK (compensation_amount >= 0),
  transport_cost   bigint NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  walk_out_doc_no      text,
  guest_signature_ref  text,
  staff_signature_ref  text,
  approved_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','EXECUTED','REJECTED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_moves_target CHECK (to_room_id IS NOT NULL OR move_type = 'WALK_OUT'),
  CONSTRAINT ck_room_moves_approval CHECK (status = 'PROPOSED' OR approved_by IS NOT NULL),
  CONSTRAINT ck_room_moves_price_lock CHECK (price_locked),
  CONSTRAINT ck_room_moves_walkout_doc CHECK (move_type <> 'WALK_OUT' OR walk_out_doc_no IS NOT NULL)
);

CREATE TABLE room_merges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  secondary_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_id            uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  move_type          text NOT NULL CHECK (move_type IN ('MERGE_SHARE','MERGE_CONNECTING')),
  consent_primary    boolean NOT NULL DEFAULT false,
  consent_secondary  boolean NOT NULL DEFAULT false,
  discount_pct       numeric(5,2) NOT NULL CHECK (discount_pct BETWEEN 0 AND 100),
  discount_amount    bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  approved_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'PENDING_CONSENT'
                     CHECK (status IN ('PENDING_CONSENT','APPROVED','ACTIVE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_room_merges_distinct CHECK (primary_booking_id <> secondary_booking_id),
  CONSTRAINT ck_room_merges_consent CHECK (status NOT IN ('APPROVED','ACTIVE')
    OR (consent_primary AND consent_secondary AND approved_by IS NOT NULL))
);
```

#### 3.2.6. PAY — Thanh toán & hoàn tiền

```sql
CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  type            text NOT NULL CHECK (type IN ('DEPOSIT','BALANCE','REFUND','PENALTY','EXTRA_SERVICE',
                                                 'COMPENSATION','RESCHEDULE_FEE')),
  method          text NOT NULL CHECK (method IN ('VNPAY','MOMO','CASH','BANK_TRANSFER','OTA_COLLECT')),
  amount          bigint NOT NULL CHECK (amount <> 0),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REVERSED')),
  provider_txn_id text,
  idempotency_key text NOT NULL,
  paid_at         timestamptz,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  note            text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payments_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_payments_sign CHECK ((type = 'REFUND' AND amount < 0) OR (type <> 'REFUND' AND amount > 0)),
  CONSTRAINT ck_payments_paid_at CHECK (status <> 'SUCCEEDED' OR paid_at IS NOT NULL),
  CONSTRAINT ck_payments_cash_shift CHECK (method <> 'CASH' OR created_by IS NOT NULL)
);

CREATE TABLE refund_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id           uuid REFERENCES payments(id) ON DELETE SET NULL,
  policy_id            uuid NOT NULL REFERENCES cancellation_policies(id) ON DELETE RESTRICT,
  hours_before_check_in numeric(10,2) NOT NULL,
  applied_tier_id      uuid REFERENCES cancellation_tiers(id) ON DELETE SET NULL,
  refund_percent       numeric(5,2) NOT NULL CHECK (refund_percent >= 0 AND refund_percent <= 100),
  requested_amount     bigint NOT NULL CHECK (requested_amount >= 0),
  approved_amount      bigint CHECK (approved_amount IS NULL OR approved_amount >= 0),
  refund_fee           bigint NOT NULL DEFAULT 0 CHECK (refund_fee >= 0),
  net_refund           bigint GENERATED ALWAYS AS
                         (coalesce(approved_amount, requested_amount) - refund_fee) STORED,
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','PAID','CANCELLED')),
  is_force_majeure     boolean NOT NULL DEFAULT false,
  evidence_refs        text[] NOT NULL DEFAULT '{}',
  reason               text NOT NULL CHECK (reason IN
                       ('GUEST_REQUEST','FORCE_MAJEURE','HOTEL_RELOCATION','PAYMENT_TIMEOUT',
                        'DUPLICATE','NO_SHOW','SYSTEM','OTA_CANCELLATION','EARLY_CHECKOUT')),
  requested_by         uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by          uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at           timestamptz,
  cancelled_at         timestamptz,
  paid_at              timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_refund_requests_two_level CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_refund_requests_force_majeure CHECK (NOT is_force_majeure OR reason = 'FORCE_MAJEURE'),
  CONSTRAINT ck_refund_requests_paid CHECK (status <> 'PAID' OR (approved_amount IS NOT NULL AND paid_at IS NOT NULL)),
  CONSTRAINT ck_refund_requests_cancelled CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND decided_at IS NULL))
);
```

#### 3.2.7. CRM (tiếp) — Điểm thưởng (tạo sau `bookings`)

```sql
CREATE TABLE loyalty_transactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id   uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  points     integer NOT NULL CHECK (points <> 0),
  type       text NOT NULL CHECK (type IN ('EARN','REDEEM','EXPIRE','ADJUST')),
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_loyalty_booking_type UNIQUE NULLS NOT DISTINCT (guest_id, booking_id, type)
);
```

#### 3.2.8. SYS — Hệ thống, thông báo & nhật ký

```sql
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid REFERENCES bookings(id) ON DELETE SET NULL,
  recipient     text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('EMAIL','SMS','ZALO_OA','PUSH')),
  template      text NOT NULL,
  payload_json  jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','CANCELLED')),
  sent_at       timestamptz,
  retry_count   smallint NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_notifications_sent CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  before_json jsonb,
  after_json  jsonb,
  reason      text,
  ip_address  inet,
  at          timestamptz NOT NULL DEFAULT now(),
  prev_hash   text,
  row_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- Khoá bắt buộc theo BR-SYS-02: refund.feeAmount, job.hold.releaseIntervalSeconds,
-- job.holdReconcile.intervalSeconds, job.channelSync.intervalSeconds, job.overbooking.scanIntervalMinutes,
-- job.occupancy.snapshotIntervalSeconds, job.noShow.markTime, deal.threshold.minor,
-- deal.threshold.checkInDebt, checkInDebtPct, channel.lowInventoryThreshold,
-- pricing.weekendMultiplier, pricing.maxDiscountPct, overbooking.transportSupportCap.
CREATE TABLE system_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       text NOT NULL,
  value_type  text NOT NULL DEFAULT 'STRING' CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','JSON')),
  description text,
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE,
  actor_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  request_hash       text NOT NULL,
  response_status    smallint NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body_json jsonb,
  expires_at         timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_idempotency_keys_expiry CHECK (expires_at > created_at)
);

CREATE TABLE outbox_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  channel_id     uuid REFERENCES channels(id) ON DELETE SET NULL,
  payload_json   jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED','DEAD_LETTER')),
  attempts       smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text,
  available_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_outbox_published CHECK (status <> 'PUBLISHED' OR processed_at IS NOT NULL)
);

CREATE TABLE occupancy_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room_type_id   uuid REFERENCES room_types(id) ON DELETE CASCADE,
  date           date NOT NULL,
  physical_rooms smallint NOT NULL CHECK (physical_rooms >= 0),
  sold_rooms     smallint NOT NULL CHECK (sold_rooms >= 0),
  occupancy_pct  numeric(5,2) NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 200),
  captured_at    timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_occupancy_snapshots_scope UNIQUE NULLS NOT DISTINCT (property_id, room_type_id, date)
);
```


### 3.3. Ràng buộc loại trừ, trigger bảo vệ bất biến

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- BR-INV-03 — BẤT BIẾN CỨNG: mỗi (room_id, bed_no, đêm) tối đa 1 RoomAssignment hoạt động.
-- Đơn vị bán là (phòng, giường): bed_no = 0 nghĩa là "cả phòng" (mọi loại phòng bán theo
-- phòng), bed_no = 1..bedCount là giường cụ thể (chỉ DOR — BR-PROP-04, MERGE_SHARE).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE room_assignments
  ADD CONSTRAINT excl_room_assignments_no_double_booking
  EXCLUDE USING gist (room_id WITH =, bed_no WITH =, valid_range WITH &&)
  WHERE (released_at IS NULL);

-- Đơn vị bán hợp lệ: giường chỉ tồn tại ở phòng đa giường, số giường không vượt sức chứa phòng.
CREATE OR REPLACE FUNCTION fn_guard_bed_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_shared   boolean;
  v_bed_count smallint;
BEGIN
  SELECT rt.allow_shared, r.bed_count INTO v_shared, v_bed_count
    FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
   WHERE r.id = NEW.room_id;
  IF NEW.bed_no = 0 THEN RETURN NEW; END IF;
  IF NOT v_shared THEN
    RAISE EXCEPTION 'E_PROP_NOT_SHARED: phòng % bán theo phòng, không dùng bed_no > 0', NEW.room_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.bed_no > v_bed_count THEN
    RAISE EXCEPTION 'E_PROP_BED_NO_RANGE: bed_no % vượt số giường % của phòng', NEW.bed_no, v_bed_count
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_room_assignments_bed_no
  BEFORE INSERT OR UPDATE ON room_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_bed_no();

-- Phòng không đa dụng chỉ có đúng 1 giường (BR-PROP-04).
CREATE OR REPLACE FUNCTION fn_guard_room_bed_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_shared boolean;
BEGIN
  SELECT allow_shared INTO v_shared FROM room_types WHERE id = NEW.room_type_id;
  IF v_shared IS NOT TRUE AND NEW.bed_count <> 1 THEN
    RAISE EXCEPTION 'E_PROP_BED_COUNT: phòng không đa dụng phải có bed_count = 1'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rooms_bed_count
  BEFORE INSERT OR UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_bed_count();

-- Không thể khoá một phòng lên lịch đang có assignment hoạt động (BR-INV-06).
CREATE OR REPLACE FUNCTION fn_guard_room_block_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_room_id uuid          := COALESCE(NEW.room_id, OLD.room_id);
  v_range   daterange;
BEGIN
  IF TG_TABLE_NAME = 'room_blocks' THEN
    v_range := daterange(NEW.start_date, NEW.end_date, '[)');
    IF EXISTS (SELECT 1 FROM room_assignments ra
                WHERE ra.room_id = v_room_id
                  AND ra.released_at IS NULL
                  AND ra.valid_range && v_range) THEN
      IF fn_current_role() NOT IN ('MANAGER','OWNER') THEN
        RAISE EXCEPTION 'E_INV_BLOCK_OVERLAP: khoá phòng chồng lấn lịch đang hoạt động'
          USING ERRCODE = '23P01';
      END IF;
    END IF;
  ELSE
    v_range := NEW.valid_range;
    IF EXISTS (SELECT 1 FROM room_blocks b
                WHERE b.room_id = v_room_id
                  AND daterange(b.start_date, b.end_date, '[)') && v_range) THEN
      IF fn_current_role() NOT IN ('MANAGER','OWNER') THEN
        RAISE EXCEPTION 'E_INV_ROOM_BLOCKED: phòng đang bị khoá trong khoảng ngày này'
          USING ERRCODE = '23P01';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_room_blocks_overlap_guard
  BEFORE INSERT OR UPDATE ON room_blocks
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_block_overlap();

CREATE TRIGGER trg_room_assignments_block_guard
  BEFORE INSERT OR UPDATE ON room_assignments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_room_block_overlap();

-- BR-INV-05 — allotment một ngày không vượt số đơn vị bán của loại phòng.
CREATE OR REPLACE FUNCTION fn_guard_allotment_capacity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_physical integer;
BEGIN
  SELECT sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int INTO v_physical
    FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id
   WHERE r.room_type_id = NEW.room_type_id AND r.status = 'ACTIVE';
  IF NEW.allotment > coalesce(v_physical, 0) THEN
    RAISE EXCEPTION 'E_INV_ALLOTMENT_EXCEEDS_ROOMS: allotment % > % đơn vị bán',
      NEW.allotment, v_physical USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_channel_allotments_capacity
  BEFORE INSERT OR UPDATE ON channel_allotments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_allotment_capacity();

-- BR-SYS-01 + NFR-SEC-04 — AuditLog append-only: bất biến cả khi có quyền superuser.
CREATE OR REPLACE FUNCTION fn_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'E_SYS_AUDIT_IMMUTABLE: AuditLog là append-only, cấm UPDATE/DELETE'
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_append_only();

-- NFR-SEC-04 — chuỗi băm: mỗi bản ghi băm cả bản ghi trước, phát hiện sửa lén.
CREATE OR REPLACE FUNCTION fn_audit_logs_hash_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_logs.chain'));
  SELECT row_hash INTO v_prev FROM audit_logs ORDER BY at DESC, id DESC LIMIT 1;
  NEW.prev_hash := v_prev;
  NEW.row_hash  := encode(digest(
      coalesce(v_prev, 'GENESIS') || '|' || NEW.id::text || '|' ||
      coalesce(NEW.actor_id::text, '-') || '|' || NEW.action || '|' ||
      NEW.entity_type || '|' || coalesce(NEW.entity_id::text, '-') || '|' ||
      coalesce(NEW.before_json::text, '{}') || '|' || coalesce(NEW.after_json::text, '{}') || '|' ||
      NEW.at::text, 'sha256'), 'hex');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_audit_logs_hash_chain
  BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_hash_chain();

-- Cập nhật updated_at tự động cho mọi bảng nghiệp vụ (AuditLog được miễn: append-only).
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
       AND c.table_name <> 'audit_logs'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at()',
      'trg_' || t.table_name || '_touch', t.table_name);
  END LOOP;
END $$;
```

### 3.4. Chỉ mục

```sql
-- Tồn phòng theo khoảng ngày (BR-INV-01, BR-INV-07, UC-INV-01/02)
CREATE INDEX idx_room_assignments_active_room_range
  ON room_assignments USING gist (room_id, bed_no, valid_range) WHERE released_at IS NULL;
CREATE INDEX idx_room_assignments_booking_room
  ON room_assignments (booking_room_id) WHERE released_at IS NULL;
CREATE INDEX idx_rooms_active_by_type
  ON rooms (room_type_id, property_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_room_blocks_range
  ON room_blocks USING gist (room_id, (daterange(start_date, end_date, '[)')));
-- Booking theo khách, theo cơ sở và theo hạn cọc (UC-BOOK-07, BR-PAY-02)
CREATE INDEX idx_bookings_guest_created ON bookings (guest_id, created_at DESC);
CREATE INDEX idx_bookings_property_checkin ON bookings (property_id, check_in);
CREATE INDEX idx_bookings_deposit_due
  ON bookings (status, check_in) WHERE status IN ('HELD','PENDING_PAYMENT');
CREATE INDEX idx_bookings_hold_expiry
  ON bookings (hold_expires_at) WHERE status = 'HELD';
CREATE UNIQUE INDEX uq_bookings_channel_external_ref
  ON bookings (channel_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX idx_bookings_cancel_reason
  ON bookings (cancel_reason) WHERE cancel_reason IS NOT NULL;
-- Thanh toán theo ngày, theo booking và theo ca (UC-PAY-05, BR-PAY-10)
CREATE INDEX idx_payments_paid_at ON payments (paid_at) WHERE status = 'SUCCEEDED';
CREATE INDEX idx_payments_booking ON payments (booking_id, created_at DESC);
CREATE INDEX idx_refund_requests_status ON refund_requests (status, created_at DESC);
-- Đồng bộ kênh qua outbox (BR-CHAN-02, BR-CHAN-06)
CREATE INDEX idx_outbox_pending
  ON outbox_events (available_at, created_at) WHERE status IN ('PENDING','FAILED');
-- Quá tải: gộp trùng theo (property, date, roomType) và hạn T−24h (BR-OVER-04/05)
CREATE UNIQUE INDEX uq_overbooking_open_case
  ON overbooking_cases (property_id, date, room_type_id) WHERE status <> 'RESOLVED';
CREATE INDEX idx_overbooking_deadline
  ON overbooking_cases (date) WHERE status <> 'RESOLVED';
-- Giá, mùa, allotment (UC-RATE-01/02/05, UC-INV-03)
CREATE INDEX idx_rate_calendars_date ON rate_calendars (date);
CREATE INDEX idx_seasons_window ON seasons (start_date, end_date) WHERE status = 'ACTIVE';
CREATE INDEX idx_channel_allotments_date ON channel_allotments (date, room_type_id);
-- Khách, điểm thưởng, danh sách đen (UC-CRM-01/02/03)
CREATE UNIQUE INDEX uq_guests_phone ON guests (phone) WHERE anonymized_at IS NULL;
CREATE INDEX idx_guests_blacklist ON guests (blacklisted) WHERE blacklisted;
CREATE INDEX idx_loyalty_guest_created ON loyalty_transactions (guest_id, created_at DESC);
-- Nhật ký kiểm toán & hàng đợi thông báo (UC-SYS-01, BR-SYS-06)
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, at DESC);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, at DESC);
CREATE INDEX idx_notifications_pending
  ON notifications (status, created_at) WHERE status IN ('PENDING','FAILED');
-- Buồng phòng, điều chuyển, công suất (BR-FO-06, UC-OVER-02, BR-RATE-04.3)
CREATE INDEX idx_housekeeping_date_status ON housekeeping_tasks (business_date, status);
CREATE INDEX idx_room_moves_booking ON room_moves (booking_id, created_at DESC);
CREATE UNIQUE INDEX uq_room_merges_active_secondary
  ON room_merges (secondary_booking_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_room_merges_active_primary
  ON room_merges (primary_booking_id) WHERE status = 'ACTIVE';
CREATE INDEX idx_rate_calendars_lookup
  ON rate_calendars (room_type_id, date, priority DESC, channel_code, created_at);
CREATE INDEX idx_payments_collector_vn_day
  ON payments (created_by, ((paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
  WHERE method = 'CASH' AND status = 'SUCCEEDED';
CREATE INDEX idx_occupancy_snapshots_property_date
  ON occupancy_snapshots (property_id, date) WHERE room_type_id IS NULL;
CREATE INDEX idx_idempotency_keys_expiry ON idempotency_keys (expires_at);
CREATE INDEX idx_channel_property_settings_effective
  ON channel_property_settings (channel_id, property_id, effective_from DESC);
```

### 3.5. Vai trò CSDL và quyền (append-only)

```sql
-- BR-SYS-01 — thu hồi quyền ghi trên bảng append-only ở tầng CSDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_ro') THEN
    CREATE ROLE analytics_ro LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_rw, app_ro, analytics_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro, analytics_ro;

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, app_ro, analytics_ro;

-- Quyền mặc định cho bảng tạo về sau; mọi migration PHẢI chạy lại khối REVOKE ở trên
-- cho các bảng append-only mới (xem §8.3 Quy tắc migration).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;
```

---

## 4. Ràng buộc chống trùng phòng — phần cốt lõi (BR-INV-03)

### 4.1. DDL đầy đủ

```sql
-- 1. Cột sinh khoảng ngày nửa mở [start_date, end_date)
ALTER TABLE room_assignments
  ADD COLUMN valid_range daterange
    GENERATED ALWAYS AS (daterange(start_date, end_date, '[)')) STORED;

-- 2. Kiểu chỉ mục gist cho uuid (btree_gist) + ràng buộc loại trừ trên BỘ BA
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE room_assignments
  ADD CONSTRAINT excl_room_assignments_no_double_booking
  EXCLUDE USING gist (room_id WITH =, bed_no WITH =, valid_range WITH &&)
  WHERE (released_at IS NULL);
```

### 4.2. Ràng buộc này hoạt động thế nào

| Thành phần | Vai trò |
|-----------|---------|
| `daterange(start_date, end_date, '[)')` | Khoảng **nửa mở**: đêm cuối là `end_date − 1`. Trả phòng ngày 27 rồi nhận phòng ngày 27 là hai đêm khác nhau, **không** chồng lấn |
| `WITH =` trên `room_id` | Chỉ đối kháng khi **cùng một phòng vật lý** |
| `WITH =` trên `bed_no` | Đơn vị bán: `0` = cả phòng (mọi loại trừ DOR), `1..bedCount` = giường cụ thể. Hai khách ở hai giường khác nhau của cùng phòng DOR **không** va chạm; cùng một giường thì va chạm |
| `WITH &&` trên `valid_range` | Giao khoảng khác rỗng ⇒ chiếm trùng đêm cùng đơn vị bán ⇒ bị từ chối |
| `WHERE (released_at IS NULL)` | Chỉ áp cho `RoomAssignment` **đang hoạt động**; bản ghi đã giải phóng (đổi phòng, huỷ, hết hạn hold) không chiếm tồn nhưng vẫn giữ để kiểm toán |
| `btree_gist` | Lớp toán tử GiST cho `uuid` và `smallint` để ghép cùng `daterange` trong một chỉ mục loại trừ |

Chỉ mục GiST mà ràng buộc tạo ra **đồng thời phục vụ truy vấn tồn phòng** (`room_id` + `bed_no` + giao khoảng ngày) nên không phát sinh chỉ mục thừa (§6, Q1–Q3 §9).

### 4.3. Vì sao bộ ba `(room_id, bed_no, valid_range)`, **không** dùng khoá đơn tổng hợp

| Phương án | Kết quả |
|-----------|---------|
| **Bộ ba `(room_id, bed_no, valid_range)` (đã chọn)** | Đúng ngữ nghĩa đơn vị bán. `bed_no = 0` cho phòng bán nguyên phòng; `1..6` cho từng giường DOR ⇒ BR-PROP-04 (bán theo giường) và `MERGE_SHARE` (hai booking chung một phòng DOR) cùng tồn tại |
| Khoá đơn sinh kiểu `sell_unit_id` / `COALESCE(bed_no::text, room_id)` | **Bị cấm**: số giường lặp lại ở mọi phòng (giường 1 của CS01-301 và giường 1 của CS03-203), khoá gộp sẽ **va chạm giữa hai phòng khác nhau** và chặn oan các lần gán phòng hợp lệ |
| `UNIQUE (room_id, bed_no, start_date, end_date)` | Chỉ chặn hai bản ghi **trùng khít** ngày; kỳ `24→27` và `25→28` vẫn lọt dù chồng hai đêm. `EXCLUDE … WITH &&` so **giao khoảng** |

### 4.4. Vì sao PHẢI là ràng buộc CSDL, không phải kiểm tra ở ứng dụng

| # | Lý do | Hệ quả nếu chỉ kiểm tra ở ứng dụng |
|---|-------|-------------------------------------|
| 1 | **Tranh chấp đồng thời**: hai yêu cầu cùng đêm đọc "còn 1 đơn vị" rồi cùng ghi (đọc–ghi không nguyên tử) | Bán trùng ngay cao điểm — tái diễn sự cố 2–4 vụ/tháng |
| 2 | **Nhiều đường ghi**: web khách, app Android, webhook OTA, job lịch, script vận hành, migration dữ liệu | Một đường ghi quên kiểm tra là đủ phá bất biến; phải sửa 6 nơi thay vì ép 1 nơi |
| 3 | **Nhiều tiến trình API**: `SELECT … FOR UPDATE` (BR-INV-02) chỉ hiệu lực trong một transaction của một kết nối; khoá phân tán Redis có thể hết hạn hoặc mất khi sự cố | Ràng buộc CSDL là **tuyến phòng thủ cuối**, không phụ thuộc hạ tầng trung gian |
| 4 | **Dữ liệu cũ**: nhập lịch sử, phục hồi bản sao lưu, sửa dữ liệu bằng SQL | Dữ liệu sai vẫn lọt qua kiểm tra ở ứng dụng |
| 5 | **Chi phí**: ràng buộc chạy trong chính câu `INSERT`, không thêm khoá, không thêm round-trip | Nhanh hơn và ít mã hơn kiểm tra hai bước ở tầng dịch vụ |

Tầng ứng dụng vẫn kiểm tra tồn **trước** (báo lỗi thân thiện, chốt giá) và giữ chỗ vẫn dùng khoá bi quan theo BR-INV-02; nhưng tính đúng đắn cuối cùng do `EXCLUDE` bảo đảm (BR-INV-03, NFR-REL-01).

### 4.5. Ánh xạ mã lỗi PostgreSQL → mã lỗi nghiệp vụ

| SQLSTATE | Nguồn sinh | Mã lỗi ứng dụng | HTTP |
|----------|-----------|-----------------|------|
| **`23P01`** | `excl_room_assignments_no_double_booking` (mất tranh chấp đơn vị bán) | **`E_INV_ROOM_TAKEN`** | 409 |
| `23P01` | trigger `trg_room_blocks_overlap_guard`, `trg_room_assignments_block_guard` | `E_INV_ROOM_BLOCKED` · `E_INV_BLOCK_OVERLAP` | 409 |
| `23505` | `payments.idempotency_key` | **`E_PAY_CALLBACK_DUPLICATE`** — trả **kết quả cũ**, không tạo `Payment` mới | 200 |
| `23505` | `idempotency_keys.key` | trả lại `response_status` + `response_body_json` đã lưu (BR-GEN-08) | theo bản ghi gốc |
| `23505` | `bookings.code` · `uq_bookings_channel_external_ref` · `uq_guests_phone` | `E_BOOK_DUPLICATE` · trả booking đã có · `E_CRM_DUPLICATE_PHONE` | 409 / 200 |
| `23514` | `CHECK` nghiệp vụ; trigger `bed_no`, `bed_count`, allotment | `E_BOOK_OVER_CAPACITY` · `E_OVER_NO_CONSENT` · `E_OVER_MERGE_GENDER` (khác giới chưa duyệt) · `E_INV_ALLOTMENT_EXCEEDS_ROOMS` · `E_CANCEL_ALREADY_DECIDED` | 422 |
| `23503` | FK `RESTRICT` (xoá cứng booking đã có thanh toán) | `E_BOOK_NOT_DELETABLE` (BR-BOOK-14/17) | 409 |
| `42501` | trigger `AuditLog` append-only, `REVOKE` | `E_AUTH_FORBIDDEN` (lỗi cấu hình vai trò, không phải lỗi người dùng) | 403 |
| `40001` / `40P01` | `serialization_failure` / `deadlock_detected` khi giữ chỗ | không phải lỗi nghiệp vụ — **thử lại** tối đa 3 lần, backoff luỹ thừa | 503 khi hết lượt |

Hai mã **không** sinh từ SQLSTATE, do tầng nghiệp vụ/job trả về:

| Mã | Sinh khi | BR |
|----|----------|----|
| `E_INV_NO_AVAILABILITY` (409) | Kiểm tra tồn theo từng đêm không đạt — kèm danh sách đêm thiếu | BR-INV-07 |
| `E_CHAN_SYNC_FAILED` (502/503) | Đồng bộ OTA thất bại 3 lần liên tiếp ⇒ `channels.sync_status = 'DEGRADED'` + cảnh báo `MANAGER` | BR-CHAN-07 |
| `E_OVER_LIMIT_EXCEEDED` (422) | Vượt trần bán vượt của cơ sở (`ceil(phòng ACTIVE × pct/100)`, tối thiểu 1 khi `pct > 0`) | BR-OVER-02 |
| `E_RATE_BELOW_FLOOR` | (a) **chặn 422** khi quản lý áp khuyến mãi trên màn hình cấu hình; (b) **cảnh báo không chặn** trong `PriceQuote.warnings[]` ở báo giá trực tuyến — bỏ mã, vẫn cho xác nhận | BR-RATE-12 |

**Phân biệt hai mã 409 hết phòng**: `E_INV_NO_AVAILABILITY` là *kết quả kiểm tra nghiệp vụ* (chưa ghi CSDL); `E_INV_ROOM_TAKEN` là *ràng buộc CSDL từ chối* khi có tranh chấp đồng thời. Cùng tình huống người dùng thấy, khác nguồn phát hiện. Tầng hạ tầng PHẢI bắt `23P01` và chuyển thành `E_INV_ROOM_TAKEN`, **cấm** nuốt lỗi rồi báo thành công (BR-INV-03).

---

## 5. Bất biến nghiệp vụ ép ở tầng CSDL

| # | Bất biến | Cách ép | BR / NFR |
|---|----------|---------|----------|
| 1 | Mỗi **đơn vị bán** `(room_id, bed_no, đêm)` tối đa **1** `RoomAssignment` hoạt động | `EXCLUDE USING gist (room_id WITH =, bed_no WITH =, valid_range WITH &&) WHERE released_at IS NULL` | BR-INV-03, NFR-REL-01 |
| 2 | `bed_no > 0` chỉ dùng cho phòng đa dụng và không vượt `bedCount` | Trigger `trg_room_assignments_bed_no` ném `23514` | BR-PROP-04, BR-OVER §9.4 |
| 3 | Phòng không đa dụng có đúng 1 đơn vị bán | Trigger `trg_rooms_bed_count` | BR-PROP-04, BR-PROP-03 |
| 4 | `check_out > check_in` (tối thiểu 1 đêm) | `CHECK ck_bookings_range`, `ck_room_assignments_range` (miền: `StayPeriod`) | BR-BOOK-03 |
| 5 | Số đêm luôn khớp khoảng ngày | Cột sinh `bookings.nights` | BR-BOOK-03/10 |
| 6 | Số dư đúng công thức; booking đã huỷ/no-show/expired chỉ nợ phụ thu | Cột sinh `bookings.balance_due` theo `status` | BR-PAY-02 |
| 7 | Thứ tự tạo booking tăng đơn điệu để xếp ưu tiên tất định | `SEQUENCE bookings_seq` + `bookings.seq UNIQUE` | BR-OVER-11 |
| 8 | Mã booking đúng `PH-<YYMMDD>-<5 ký tự>` và duy nhất | `CHECK (code ~ …)` + `UNIQUE` | BR-GEN-06 |
| 9 | Tổng hoàn luỹ kế ≤ số đã trả | `CHECK ck_bookings_refund_cap` | BR-CANCEL-17, BR-PAY-07 |
| 10 | Người tạo **không** tự duyệt yêu cầu hoàn tiền của mình | `CHECK ck_refund_requests_two_level` | BR-CANCEL-15 |
| 11 | `isForceMajeure` ⇒ `reason = 'FORCE_MAJEURE'`; lý do ≥ 20 ký tự ghi ở `audit_logs.reason` | `CHECK ck_refund_requests_force_majeure` + quy trình | BR-CANCEL-13 |
| 12 | Chỉ `PAID` khi đã có số duyệt và mốc chi | `CHECK ck_refund_requests_paid` | BR-CANCEL-16 |
| 13 | Yêu cầu đã `APPROVED`/`PAID` **không** huỷ được | `CHECK ck_refund_requests_cancelled` | BR-CANCEL-18 |
| 14 | `refundBase` phân bổ theo phòng bị huỷ; phòng còn lại giữ nguyên | `booking_rooms.status/cancelled_at` + `refund_requests.net_refund` (cột sinh) | **BR-CANCEL-19**, BR-CANCEL-05 |
| 15 | Callback trùng khoá idempotency không tạo bút toán thứ hai | `UNIQUE (payments.idempotency_key)` | BR-PAY-03 |
| 16 | Mọi thao tác ghi gửi lại trong 24 giờ trả đúng kết quả cũ | `idempotency_keys.key UNIQUE`, `expires_at > created_at` | BR-GEN-08 |
| 17 | Hoàn tiền là bút toán đảo (ghi âm); bút toán gốc không bị sửa | `CHECK ck_payments_sign` + nghiệp vụ chỉ `INSERT` | BR-PAY-09 |
| 18 | Tiền mặt phải gắn người thu (đối soát theo cặp *người thu – ngày VN*) | `CHECK ck_payments_cash_shift` + `idx_payments_collector_vn_day` | BR-PAY-06/10 |
| 19 | `allotment` không vượt số **đơn vị bán** `ACTIVE`; `used ≤ allotment` | Trigger `trg_channel_allotments_capacity` + `CHECK ck_channel_allotments_used` | BR-INV-05, BR-CHAN-01/08 |
| 20 | Khoá phòng không chồng lấn lịch hoạt động (trừ `MANAGER`+ có lý do) | Trigger `trg_room_blocks_overlap_guard` / `trg_room_assignments_block_guard` ném `23P01` | BR-INV-06 |
| 21 | Một ca quá tải chưa xử lý cho mỗi `(cơ sở, ngày, loại phòng)` | `UNIQUE` từng phần `uq_overbooking_open_case … WHERE status <> 'RESOLVED'` | BR-OVER-05 |
| 22 | Ca `RESOLVED` có người và thời điểm; ca `ESCALATED` có mốc leo thang (case quá hạn không tự đóng) | `CHECK ck_overbooking_resolved`, `ck_overbooking_escalated` | BR-OVER-04, **BR-OVER-16** |
| 23 | Điều chuyển giữ nguyên giá gốc | `CHECK ck_room_moves_price_lock (price_locked)` | BR-OVER-08 |
| 24 | `RoomMove` phải có phòng đích, trừ `WALK_OUT`; `WALK_OUT` phải có số biên bản | `CHECK ck_room_moves_target`, `ck_room_moves_walkout_doc` | [02 §9.2](../02-nghiep-vu/quy-tac-nghiep-vu.md#92-thang-xử-lý-khi-thiếu-phòng), BR-OVER-06 |
| 25 | `keepScore` nằm trong miền giá trị của công thức | `CHECK (keep_score BETWEEN 0 AND 173)` | BR-OVER-11 |
| 26 | Ghép phòng chỉ `APPROVED`/`ACTIVE` khi cả hai đồng ý **và** `MANAGER`+ đã duyệt | `CHECK ck_room_merges_consent` | BR-OVER-13/14 |
| 27 | Một booking không nằm trong hai ghép đang hoạt động (mỗi vai) | `uq_room_merges_active_primary`, `…_secondary` | BR-OVER-13 |
| 28 | `HELD` phải có `hold_expires_at`; `CANCELLED` phải có `cancelled_at` | `CHECK ck_bookings_hold`, `ck_bookings_cancelled` | BR-BOOK-07/14 |
| 29 | Không xoá cứng booking đã phát sinh thanh toán | FK `payments.booking_id ON DELETE RESTRICT` | BR-BOOK-14 |
| 30 | Xoá cứng `DRAFT`/`HELD` vẫn giữ vết nhật ký | `audit_logs.entity_id` không FK + `before_json` ghi trước khi xoá | **BR-BOOK-17**, BR-GEN-07 |
| 31 | Giá đã chốt bất biến, lưu theo lần (`ORIGINAL`/`RESCHEDULE`/`PARTIAL_CANCEL`) kèm `engineVersion` | `UNIQUE (booking_id, seq)` + FK `channel_property_setting_id` | BR-RATE-16, BR-RATE-18 |
| 32 | Khách nhận diện duy nhất theo SĐT chuẩn hoá `+84…` | `UNIQUE` từng phần `uq_guests_phone … WHERE anonymized_at IS NULL` | BR-CRM-01 |
| 33 | Mỗi booking chỉ sinh điểm một lần cho mỗi loại bút toán | `UNIQUE NULLS NOT DISTINCT (guest_id, booking_id, type)` | BR-CRM-03/06 |
| 34 | Sàn ≤ giá cơ bản ≤ trần; mã loại phòng thuộc enum | `CHECK ck_room_types_price_band`, `CHECK code IN (…)` | BR-RATE-03/04 |
| 35 | `RateCalendar.priority` khớp `source`; giá ghi đè phải có lý do | `CHECK ck_rate_calendars_priority`, `ck_rate_calendars_reason` | BR-RATE-02 |
| 36 | Mã phòng OTA duy nhất trong một kênh; mỗi loại phòng một ánh xạ | `uq_channel_mappings_external`, `uq_channel_mappings_room` | BR-CHAN-08 |
| 37 | Mỗi `(kênh, cơ sở, effectiveFrom)` một dòng cấu hình hoa hồng/hệ số | `uq_channel_property_settings` | BR-RATE-18 |
| 38 | Mã phòng duy nhất trong phạm vi một cơ sở | `UNIQUE (property_id, code)` | BR-PROP-05 |
| 39 | Một nhiệm vụ buồng phòng cho mỗi `(phòng, ngày nghiệp vụ)` | `UNIQUE uq_housekeeping_room_date` | BR-FO-06 |
| 40 | Khuyến mãi: `PERCENT ≤ 100`, `used_count ≤ max_uses`, phạm vi thuộc enum | `CHECK ck_promotions_*` | BR-RATE-10/13/14 |
| 41 | `AuditLog` bất biến kể cả với quyền cao nhất | Trigger `trg_audit_logs_append_only` + `REVOKE UPDATE, DELETE` | BR-SYS-01, NFR-SEC-04 |
| 42 | Chuỗi băm `AuditLog` liền mạch | Trigger `trg_audit_logs_hash_chain` (SHA-256 qua `prev_hash`) | NFR-SEC-04 |
| 43 | Mọi bảng đều có `updated_at` tự cập nhật | Trigger `trg_<bảng>_touch` (trừ `AuditLog`) | Quy ước §1 |

**Bất biến không ép được ở CSDL** (quan hệ xuyên bảng trong một transaction — ép ở tầng ứng dụng + kiểm tra đối chiếu định kỳ):

| Bất biến | Lý do không ép ở CSDL | BR |
|----------|----------------------|----|
| Booking OTA vượt tồn phải có `oversold = true` **và** một `OverbookingCase` | Quan hệ xuyên ba bảng, phát sinh trong luồng webhook | BR-CHAN-03, BR-OVER-03 |
| Không bán vượt quá trần của cơ sở và trần 5% tuyệt đối | Phụ thuộc cấu hình và số phòng `ACTIVE` tại thời điểm bán | BR-OVER-02 |
| Booking rời `DRAFT` phải có `PriceSnapshot` (`HELD`/`PENDING_PAYMENT`/`CONFIRMED`) | Quan hệ xuyên bảng, kiểm bằng truy vấn đối chiếu hằng ngày | BR-RATE-16 |
| `LONGSTAY14` phải có giá riêng, khác `FLEX7` | Cảnh báo cấu hình trên màn hình, không chặn dữ liệu | BR-RATE-19 |
| `balanceDue + penaltyAmount = 0` khi check-in (hoặc `MANAGER`+ cho ghi nợ) | Quy trình tiền sảnh, có ngoại lệ được duyệt | BR-FO-01 |

---

## 6. Chỉ mục theo truy vấn thực tế

| # | Truy vấn nghiệp vụ | Chỉ mục | Loại | Lý do chọn |
|---|--------------------|---------|------|-----------|
| 1 | Tồn phòng theo khoảng ngày (Q1), kiểm tra một đơn vị bán (Q2) | `idx_room_assignments_active_room_range (room_id, bed_no, valid_range)` | GiST, từng phần `WHERE released_at IS NULL` | Do ràng buộc `EXCLUDE` tạo; phục vụ cả kiểm tra lẫn báo cáo |
| 2 | Lưới tồn phòng 30 ngày (Q3) | `idx_rooms_active_by_type (room_type_id, property_id) WHERE status = 'ACTIVE'` | B-tree từng phần | Liệt kê phòng bán được của cơ sở |
| 3 | Chặn khoá phòng chồng lấn (BR-INV-06) | `idx_room_blocks_range (room_id, (daterange(start_date, end_date)))` | GiST biểu thức | Trigger đối chiếu khoảng ngày với `room_blocks` |
| 4 | Tra giá cơ bản theo `priority` (BR-RATE-02) | `idx_rate_calendars_lookup (room_type_id, date, priority DESC, channel_code, created_at)` | B-tree tổ hợp | Mỗi đêm tra đúng một dòng thắng, kể cả khi cùng `priority` |
| 5 | Cấu hình hoa hồng/hệ số theo (kênh, cơ sở) (BR-RATE-18) | `idx_channel_property_settings_effective (channel_id, property_id, effective_from DESC)` | B-tree tổ hợp | Chọn dòng `effectiveFrom` lớn nhất ≤ ngày của đêm |
| 6 | Booking theo khách (UC-BOOK-07) | `idx_bookings_guest_created (guest_id, created_at DESC)` | B-tree tổ hợp | Lịch sử đặt phòng, mới nhất trước |
| 7 | Danh sách đến/đi theo cơ sở (UC-FO-01/02) | `idx_bookings_property_checkin (property_id, check_in)` | B-tree tổ hợp | Lọc theo cơ sở và ngày |
| 8 | Booking sắp đến hạn cọc (Q4) | `idx_bookings_deposit_due (status, check_in) WHERE status IN ('HELD','PENDING_PAYMENT')` | B-tree từng phần | Tập nhỏ, quét định kỳ |
| 9 | Job hết hạn hold (BR-INV-04, ≤ 60 giây) | `idx_bookings_hold_expiry (hold_expires_at) WHERE status = 'HELD'` | B-tree từng phần | `Booking.holdExpiresAt` là nguồn chân lý; Redis chỉ là bộ đếm nhanh |
| 10 | Huỷ theo lý do (UC-REP-03) | `idx_bookings_cancel_reason WHERE cancel_reason IS NOT NULL` | B-tree từng phần | Báo cáo huỷ, bỏ qua phần lớn bảng |
| 11 | Thanh toán theo ngày (Q5, UC-PAY-05) | `idx_payments_paid_at (paid_at) WHERE status = 'SUCCEEDED'` | B-tree từng phần | Báo cáo doanh thu – đối soát |
| 12 | Đối soát tiền mặt theo cặp *(người thu, ngày VN)* (BR-PAY-06/10) | `idx_payments_collector_vn_day (created_by, ((paid_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)) WHERE method='CASH' AND status='SUCCEEDED'` | B-tree biểu thức, từng phần | "Ngày" là ngày VN, không phải ngày UTC |
| 13 | Hàng đợi duyệt hoàn tiền (UC-PAY-04) | `idx_refund_requests_status (status, created_at DESC)` | B-tree tổ hợp | So ngưỡng trên `net_refund` |
| 14 | Chống trùng booking OTA (BR-CHAN-03) | `uq_bookings_channel_external_ref WHERE external_ref IS NOT NULL` | B-tree duy nhất từng phần | Webhook gửi lại không tạo bản ghi mới |
| 15 | Phát lại thao tác ghi theo `Idempotency-Key` (BR-GEN-08) | `idempotency_keys.key UNIQUE` + `idx_idempotency_keys_expiry` | B-tree duy nhất + B-tree | Trả kết quả cũ trong 24 giờ; job dọn bản ghi hết hạn |
| 16 | Đồng bộ kênh qua outbox (BR-CHAN-02) | `idx_outbox_pending (available_at, created_at) WHERE status IN ('PENDING','FAILED')` | B-tree từng phần | Worker chỉ thấy việc cần làm |
| 17 | Bảng điều khiển quá tải (UC-OVER-01) | `uq_overbooking_open_case`, `idx_overbooking_deadline (date) WHERE status <> 'RESOLVED'` | B-tree duy nhất/từng phần | Gộp trùng và sắp theo hạn T−24h |
| 18 | Mùa đang hiệu lực (UC-RATE-02) | `idx_seasons_window (start_date, end_date) WHERE status='ACTIVE'` | B-tree từng phần | Chọn mùa theo `priority` rồi khoảng hẹp hơn |
| 19 | Allotment theo ngày (UC-INV-03) | `idx_channel_allotments_date (date, room_type_id)` | B-tree tổ hợp | Đọc theo ngày rồi theo loại phòng |
| 20 | Tra cứu nhật ký (UC-SYS-01) | `idx_audit_logs_entity (entity_type, entity_id, at DESC)`, `idx_audit_logs_actor (actor_id, at DESC)` | B-tree tổ hợp | "Ai đã làm gì với đối tượng này" |
| 21 | Hàng đợi thông báo & gửi lại (BR-SYS-06) | `idx_notifications_pending (status, created_at) WHERE status IN ('PENDING','FAILED')` | B-tree từng phần | Gửi lại tối đa 3 lần |
| 22 | Buồng phòng theo ngày (UC-FO-03) | `idx_housekeeping_date_status (business_date, status)` | B-tree tổ hợp | Danh sách việc của nhân viên dọn phòng |
| 23 | Điểm thưởng theo khách (UC-CRM-02) | `idx_loyalty_guest_created (guest_id, created_at DESC)` | B-tree tổ hợp | Sao kê điểm |
| 24 | Điều chuyển theo booking (UC-OVER-02, UC-REP-04) | `idx_room_moves_booking (booking_id, created_at DESC)` | B-tree tổ hợp | Vết điều chuyển và tổng hợp chi phí xử lý quá tải |
| 25 | Dòng công suất cấp cơ sở (BR-RATE §4.3) | `idx_occupancy_snapshots_property_date (property_id, date) WHERE room_type_id IS NULL` | B-tree từng phần | Chỉ dòng tổng hợp được động cơ giá đọc |

**Không đánh chỉ mục** cho bảng nhỏ và ít giá trị (`properties`, `room_types`, `channels`, `cancellation_tiers`, `system_settings`, `promotions`): quét tuần tự vài chục bản ghi rẻ hơn duy trì chỉ mục. Bảng lớn dùng chỉ mục **từng phần** để không phình theo dữ liệu lịch sử.

---

## 7. Nhật ký kiểm toán append-only (BR-SYS-01, NFR-SEC-04)

### 7.1. Ba lớp bảo vệ

| Lớp | Cơ chế | Chặn được gì |
|-----|--------|--------------|
| 1. Quyền | `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, app_ro, analytics_ro` | Ứng dụng bị lộ thông tin đăng nhập vẫn không sửa được nhật ký |
| 2. Trigger | `trg_audit_logs_append_only` ném `42501` | Kể cả `superuser`/chủ sở hữu bảng cũng không `UPDATE`/`DELETE` được (muốn tắt phải `ALTER TABLE … DISABLE TRIGGER`, để lại vết DDL trong log PostgreSQL) |
| 3. Chuỗi băm | `trg_audit_logs_hash_chain`: `row_hash = SHA256(prev_hash ‖ nội dung bản ghi)` | Sửa dữ liệu ở tầng tệp hoặc phục hồi bản sao lưu bị can thiệp — phát hiện bằng truy vấn §7.3 |

### 7.2. DDL (trích §3.3 và §3.5)

```sql
CREATE OR REPLACE FUNCTION fn_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'E_SYS_AUDIT_IMMUTABLE: AuditLog là append-only, cấm UPDATE/DELETE'
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION fn_audit_logs_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw, app_ro, analytics_ro;
```

Phân vai thực thi: **ứng dụng** ghi nhật ký bằng `app_rw` (chỉ `INSERT`/`SELECT`) trong **cùng transaction** với thao tác ghi — cổng `UnitOfWork` (BR-GEN-07); **migration/quản trị** dùng vai trò chủ sở hữu riêng; **báo cáo/BI** dùng `analytics_ro` chỉ đọc. Đường xoá cứng booking `DRAFT`/`HELD` (BR-BOOK-17) PHẢI ghi `AuditLog` với `before_json` **trước** câu `DELETE` trong cùng transaction.

### 7.3. Kiểm chứng chuỗi băm

```sql
-- Số bản ghi bị đứt chuỗi (kỳ vọng 0). Chạy hằng ngày, kết quả vào báo cáo SYS.
SELECT count(*) AS broken_links
  FROM (
    SELECT prev_hash, lag(row_hash) OVER (ORDER BY at, id) AS expected_prev
      FROM audit_logs
  ) s
 WHERE prev_hash IS DISTINCT FROM expected_prev;
```

Lưu trữ: nhật ký giữ **5 năm**, booking/thanh toán **10 năm** (BR-SYS-04, NFR-COMP-02); sao lưu PITR với RPO ≤ 15 phút, RTO ≤ 4 giờ (BR-SYS-03). Nhật ký cũ chuyển sang bảng lưu trữ lạnh theo tháng (§10) nhưng `REVOKE` và trigger **phải được áp lại** cho mọi bảng mới.

---

## 8. Chiến lược migration

### 8.1. Thứ tự migration

| # | Tên file (`infra/sql`, `apps/api/prisma/migrations`) | Nội dung | Nguồn |
|---|-----------------------------------------------------|----------|-------|
| 0001 | `init_extensions` | `btree_gist`, `pgcrypto`, `SEQUENCE bookings_seq`, hàm `fn_current_role()` | Thủ công |
| 0002 | `baseline_tables` | 36 bảng §3.2 + khoá chính/ngoáI/`CHECK` cơ bản | Prisma |
| 0003 | `room_assignment_exclusion` | Cột sinh `valid_range`, `EXCLUDE USING gist (room_id, bed_no, valid_range)` | **Thủ công** |
| 0004 | `generated_columns` | `bookings.nights`, `bookings.balance_due`, `refund_requests.net_refund` | **Thủ công** |
| 0005 | `invariant_triggers` | `bed_no`, `bed_count`, khoá phòng, allotment, `updated_at`, chuỗi băm nhật ký | **Thủ công** |
| 0006 | `partial_indexes` | Toàn bộ chỉ mục §3.4 | **Thủ công** |
| 0007 | `audit_append_only` | Trigger append-only + `REVOKE` cho vai trò ứng dụng | **Thủ công** |
| 0008 | `seed_reference_data` | 3 cơ sở · 55 phòng · 75 đơn vị bán · 5 loại phòng · 7 kênh · 4 gói giá · 4 chính sách huỷ + 11 bậc · khoá `SystemSetting` (BR-SYS-02) | Prisma seed |
| 0009 | `audit_retention_partition` | Chuyển `audit_logs` sang bảng phân mảnh theo tháng (khi > 20 triệu bản ghi) | **Thủ công** |

### 8.2. Quy tắc migration (chỉ tiến, không lùi)

| # | Quy tắc | Lý do |
|---|---------|-------|
| 1 | Migration **chỉ tiến** (`forward-only`); không viết `down`. Sửa lỗi = migration bù tiến tiếp theo | CSDL đang phục vụ dữ liệu thật; `down` tự động gần như luôn mất dữ liệu |
| 2 | Không sửa file migration đã phát hành; mọi thay đổi là file mới | Lịch sử CSDL của các môi trường phải hội tụ |
| 3 | Mọi migration **idempotent** (`IF NOT EXISTS`, `DO $$ … $$`) | Chạy lại an toàn khi deploy dở dang |
| 4 | Thay đổi phá vỡ tương thích theo **expand → migrate → contract** | API cũ và mới chạy song song khi triển khai cuốn chiếu |
| 5 | `CHECK` mới trên bảng lớn: thêm `NOT VALID` rồi `VALIDATE CONSTRAINT` | Không khoá bảng lâu |
| 6 | `CREATE INDEX CONCURRENTLY` cho mọi chỉ mục trên bảng đang phục vụ; `lock_timeout = '3s'` | NFR-USE-01: không gián đoạn vận hành |
| 7 | Phần Prisma không hỗ trợ (ràng buộc loại trừ, cột sinh, chỉ mục biểu thức, trigger, `REVOKE`) **bắt buộc** nằm trong file SQL thủ công và có kiểm thử xác nhận tồn tại | ADR-003, RSK-04 |
| 8 | CI chạy `migrate` trên **CSDL trống** và trên bản sao lược đồ phiên bản trước (shadow database) | US-INF-01, ADR-011 |
| 9 | Migration ước tính > 30 giây chạy trong cửa sổ bảo trì, ngoài giờ cao điểm | NFR-USE-01 |
| 10 | Mọi migration ghi nhật ký triển khai: file, thời điểm, người chạy, kết quả, thời lượng | Truy vết vận hành |

### 8.3. Kiểm thử bắt buộc sau mỗi migration

```sql
-- 1. Mọi bảng đều có khoá chính (kỳ vọng 0 dòng)
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p');

-- 2. Ràng buộc loại trừ chống bán trùng vẫn tồn tại và đúng định nghĩa
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'room_assignments'::regclass AND contype = 'x';

-- 3. Bảng append-only không còn quyền ghi cho vai trò ứng dụng (kỳ vọng false)
SELECT has_table_privilege('app_rw', 'audit_logs', 'UPDATE') AS can_update;
```

### 8.4. Quy trình rollback

| Bước | Hành động | Ghi chú |
|------|-----------|---------|
| 1 | **Chụp ảnh trước khi migrate**: snapshot + điểm PITR | Cho phép quay lui chính xác tới trước migration |
| 2 | Chạy migration trên **bản sao lược đồ + dữ liệu** trước, đo thời lượng, chạy lại §8.3 | Không thử trên môi trường sản xuất |
| 3 | Migration **thất bại giữa chừng**: dừng phát hành, chạy migration bù tiến (idempotent) để đưa lược đồ về trạng thái mong muốn | Không chạy `down` |
| 4 | Dữ liệu hỏng/không thể bù: **phục hồi PITR** về mốc trước migration, rồi phát lại thay đổi theo outbox | RTO ≤ 4 giờ, RPO ≤ 15 phút (BR-SYS-03, NFR-REL-04) |
| 5 | Sau rollback: chạy lại §8.3, diễn tập trên bản sao, ghi biên bản sự cố | BR-SYS-03 |
| 6 | Cấm rollback trong giờ cao điểm; cần `MANAGER`+ phê duyệt và ghi `AuditLog` | BR-GEN-07 |

Chi tiết quy trình và tiêu chí vào/ra: [05/kế-hoạch-kiểm-thử](../05-ke-hoach/ke-hoach-kiem-thu.md).

---

## 9. Năm câu truy vấn then chốt

### Q1 — Tồn khả dụng **hai tầng** theo loại phòng và khoảng ngày (BR-INV-01, BR-INV-07)

Tham số: `$1` ngày nhận phòng, `$2` ngày trả phòng, `$3` mã kênh đang xét.

- `available_general` = **đơn vị bán** `ACTIVE` − `RoomBlock` − `RoomAssignment` đang hoạt động − hold **chưa sinh assignment** của kênh khác. `allotment` **không** bị trừ ở tầng này (đó là hạn mức bán của kênh, không phải tồn vật lý).
- `available_channel` = `min(available_general, allotment − used của kênh đang xét)`; kênh trực tiếp không có hạn mức riêng (BR-CHAN-01) nên bằng `available_general`.
- Hold đọc từ **`bookings`** (`status = 'HELD'`, `hold_expires_at > now()`), đúng nguồn chân lý ở [00 §7.3](../00-tong-quan.md#73-đặt-phòng-book). DOR đếm theo **giường** (`bed_count`), phòng thường đếm 1.
- Giá trị âm = số đơn vị đang thiếu ⇒ mở `OverbookingCase` với `shortage_count = −available` (BR-OVER-03).

```sql
WITH nights AS (
  SELECT gs::date AS stay_date
    FROM generate_series($1::date, $2::date - 1, interval '1 day') AS gs
),
units AS (
  SELECT r.property_id, r.room_type_id,
         sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int AS units_total
    FROM rooms r
    JOIN room_types rt ON rt.id = r.room_type_id
   WHERE r.status = 'ACTIVE'
   GROUP BY 1, 2
),
blocked AS (
  SELECT r.property_id, r.room_type_id, d.stay_date,
         sum(CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END)::int AS blocked_units
    FROM room_blocks b
    JOIN rooms r ON r.id = b.room_id
    JOIN room_types rt ON rt.id = r.room_type_id
    CROSS JOIN LATERAL generate_series(b.start_date, b.end_date - 1, interval '1 day') AS d(stay_date)
   WHERE b.start_date < $2::date AND b.end_date > $1::date
   GROUP BY 1, 2, 3
),
occupied AS (
  SELECT r.property_id, r.room_type_id, d.stay_date,
         sum(CASE WHEN ra.bed_no > 0 THEN 1 ELSE r.bed_count END)::int AS occupied_units
    FROM room_assignments ra
    JOIN rooms r ON r.id = ra.room_id
    JOIN room_types rt ON rt.id = r.room_type_id
    CROSS JOIN LATERAL generate_series(ra.start_date, ra.end_date - 1, interval '1 day') AS d(stay_date)
   WHERE ra.released_at IS NULL AND ra.start_date < $2::date AND ra.end_date > $1::date
   GROUP BY 1, 2, 3
),
held AS (
  SELECT b.property_id, b.room_type_id, d.stay_date, sum(b.room_count)::int AS held_units
    FROM bookings b
    JOIN channels hc ON hc.id = b.channel_id
    CROSS JOIN LATERAL generate_series(b.check_in, b.check_out - 1, interval '1 day') AS d(stay_date)
   WHERE b.status = 'HELD' AND b.hold_expires_at > now()
     AND hc.code <> $3::text
     AND b.check_in < $2::date AND b.check_out > $1::date
     AND NOT EXISTS (
           SELECT 1 FROM room_assignments ra
             JOIN booking_rooms br ON br.id = ra.booking_room_id
            WHERE br.booking_id = b.id AND ra.released_at IS NULL)
   GROUP BY 1, 2, 3
),
channel_quota AS (
  SELECT ca.room_type_id, ca.date AS stay_date,
         sum(ca.allotment - ca.used)::int AS quota_left
    FROM channel_allotments ca
    JOIN channels c ON c.id = ca.channel_id
   WHERE c.code = $3::text AND ca.date >= $1::date AND ca.date < $2::date
   GROUP BY 1, 2
)
SELECT pr.code AS property, rt.code AS room_type, n.stay_date,
       u.units_total - coalesce(bl.blocked_units, 0) - coalesce(oc.occupied_units, 0)
         - coalesce(hd.held_units, 0) AS available_general,
       least(u.units_total - coalesce(bl.blocked_units, 0) - coalesce(oc.occupied_units, 0)
             - coalesce(hd.held_units, 0), coalesce(cq.quota_left, 2147483647)) AS available_channel
  FROM nights n
  JOIN units u ON true
  JOIN properties pr ON pr.id = u.property_id
  JOIN room_types rt ON rt.id = u.room_type_id
  LEFT JOIN blocked bl
         ON bl.property_id = u.property_id AND bl.room_type_id = u.room_type_id AND bl.stay_date = n.stay_date
  LEFT JOIN occupied oc
         ON oc.property_id = u.property_id AND oc.room_type_id = u.room_type_id AND oc.stay_date = n.stay_date
  LEFT JOIN held hd
         ON hd.property_id = u.property_id AND hd.room_type_id = u.room_type_id AND hd.stay_date = n.stay_date
  LEFT JOIN channel_quota cq
         ON cq.room_type_id = u.room_type_id AND cq.stay_date = n.stay_date
 ORDER BY pr.code, rt.code, n.stay_date;
```

### Q2 — Một đơn vị bán cụ thể còn trống? (BR-INV-02)

Tham số: `$1` phòng, `$2` `bed_no` (`0` = cả phòng), `$3`/`$4` khoảng ngày. Tách riêng lý do bận (lịch gán phòng / khoá bảo trì) để thông báo đúng cho lễ tân.

```sql
SELECT r.code AS room_code, r.bed_count, $2::smallint AS requested_bed_no,
       (r.status = 'ACTIVE') AS room_active,
       NOT EXISTS (SELECT 1 FROM room_assignments ra
                    WHERE ra.room_id = r.id AND ra.released_at IS NULL
                      AND ($2::smallint = 0 OR ra.bed_no IN (0, $2::smallint))
                      AND ra.valid_range && daterange($3::date, $4::date, '[)')) AS free_of_assignment,
       NOT EXISTS (SELECT 1 FROM room_blocks b
                    WHERE b.room_id = r.id
                      AND daterange(b.start_date, b.end_date, '[)') && daterange($3::date, $4::date, '[)')) AS free_of_block
  FROM rooms r
 WHERE r.id = $1::uuid;
```

### Q3 — Lưới tồn phòng 30 ngày của một cơ sở (UC-INV-01)

Tham số: `$1` cơ sở, `$2` ngày bắt đầu. Trả `55 × 30` dòng cho CS-01, kèm số đơn vị bán và số đơn vị đang bị chiếm; trạng thái theo thứ tự ưu tiên: hết bán → bảo trì → đầy → còn một phần (DOR) → trống.

```sql
SELECT r.code AS room_code, rt.code AS room_type, gs::date AS stay_date,
       CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END AS sellable_units,
       coalesce(oc.occupied_units, 0) AS occupied_units,
       CASE
         WHEN r.status <> 'ACTIVE' THEN 'OUT_OF_SERVICE'
         WHEN EXISTS (SELECT 1 FROM room_blocks b
                       WHERE b.room_id = r.id
                         AND daterange(b.start_date, b.end_date, '[)') @> gs::date) THEN 'BLOCKED'
         WHEN coalesce(oc.occupied_units, 0) >= CASE WHEN rt.allow_shared THEN r.bed_count ELSE 1 END THEN 'FULL'
         WHEN coalesce(oc.occupied_units, 0) > 0 THEN 'PARTIAL'
         ELSE 'FREE'
       END AS room_state
  FROM rooms r
  JOIN room_types rt ON rt.id = r.room_type_id
  CROSS JOIN generate_series($2::date, $2::date + 29, interval '1 day') AS gs
  LEFT JOIN LATERAL (
    SELECT sum(CASE WHEN ra.bed_no > 0 THEN 1 ELSE r.bed_count END)::int AS occupied_units
      FROM room_assignments ra
     WHERE ra.room_id = r.id AND ra.released_at IS NULL AND ra.valid_range @> gs::date) oc ON true
 WHERE r.property_id = $1::uuid
 ORDER BY r.code, gs;
```

### Q4 — Danh sách booking sắp đến hạn cọc (BR-BOOK-09, BR-OVER-04)

Tham số: `$1` khoảng thời gian tới (mặc định `'24 hours'`). Hạn cọc = `hold_expires_at` nếu đang giữ chỗ, ngược lại là **giờ nhận phòng danh nghĩa − 24 giờ** (BR-GEN-04, từ `Property.checkInTime`).

```sql
SELECT b.code AS booking_code, b.status, g.full_name, g.phone, ch.code AS channel,
       b.check_in, b.check_out, b.room_count,
       (b.check_in + pr.check_in_time) AT TIME ZONE pr.timezone AS checkin_at,
       b.total_amount, b.deposit_amount, b.paid_amount,
       b.deposit_amount - b.paid_amount AS deposit_outstanding,
       b.hold_expires_at,
       coalesce(b.hold_expires_at,
                ((b.check_in + pr.check_in_time) AT TIME ZONE pr.timezone) - interval '24 hours') AS deposit_deadline
  FROM bookings b
  JOIN guests g ON g.id = b.guest_id
  JOIN properties pr ON pr.id = b.property_id
  JOIN channels ch ON ch.id = b.channel_id
 WHERE b.status IN ('HELD','PENDING_PAYMENT')
   AND b.paid_amount < b.deposit_amount
   AND coalesce(b.hold_expires_at,
                ((b.check_in + pr.check_in_time) AT TIME ZONE pr.timezone) - interval '24 hours')
       <= now() + $1::interval
 ORDER BY deposit_deadline;
```

### Q5 — Báo cáo doanh thu gộp và thuần theo kênh (BR-RATE-08, UC-REP-02)

Tham số: `$1`, `$2` khoảng ngày. Doanh thu ghi nhận trên booking đã xác nhận/đã ở; **doanh thu thuần = gộp × (1 − hoa hồng)**; huỷ và no-show báo riêng để không trộn vào doanh thu.

```sql
WITH realized AS (
  SELECT b.channel_id, sum(b.total_amount) AS gross, sum(b.refunded_amount) AS refunded
    FROM bookings b
   WHERE b.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
     AND b.check_in >= $1::date AND b.check_in < $2::date
   GROUP BY b.channel_id
),
cancelled AS (
  SELECT b.channel_id, count(*)::int AS cancelled_bookings, sum(b.refunded_amount) AS refunded_amount
    FROM bookings b
   WHERE b.status IN ('CANCELLED','NO_SHOW','EXPIRED')
     AND b.check_in >= $1::date AND b.check_in < $2::date
   GROUP BY b.channel_id
)
SELECT ch.code AS channel_code, ch.name AS channel_name, ch.commission_pct,
       coalesce(rz.gross, 0) AS gross_revenue,
       round(coalesce(rz.gross, 0) * ch.commission_pct / 100.0)::bigint AS ota_commission,
       round(coalesce(rz.gross, 0) * (100 - ch.commission_pct) / 100.0)::bigint AS net_revenue,
       coalesce(cx.cancelled_bookings, 0) AS cancelled_bookings,
       coalesce(cx.refunded_amount, 0) AS refunded_of_cancelled
  FROM channels ch
  LEFT JOIN realized rz ON rz.channel_id = ch.id
  LEFT JOIN cancelled cx ON cx.channel_id = ch.id
 ORDER BY net_revenue DESC;
```

---

## 10. Ước lượng dung lượng & tăng trưởng

Giả định thiết kế: **75 đơn vị bán** (34 + 23 + 18 — BR-PROP-03), công suất bình quân 55%, kỳ lưu trú bình quân 2,2 đêm ⇒ **≈ 15.000 đơn vị–đêm/năm**, **≈ 6.800 booking/năm**, tỷ lệ huỷ 12% (BR-REP-01).

| Bảng | Bản ghi/năm | Cỡ dòng | Dung lượng/năm | Chiến lược lưu trữ |
|------|-------------|---------|----------------|--------------------|
| `bookings` | ≈ 6.800 | ~680 B | ~4,6 MB | Giữ 10 năm (BR-SYS-04) |
| `booking_rooms` | ≈ 7.800 | ~170 B | ~1,3 MB | Giữ 10 năm |
| `room_assignments` | ≈ 15.500 | ~210 B | ~3,3 MB | Giữ 10 năm; chỉ mục GiST từng phần |
| `booking_status_history` | ≈ 34.000 | ~150 B | ~5 MB | Giữ 3 năm rồi lưu trữ lạnh |
| `price_snapshots` | ≈ 7.500 | ~2 KB | ~15 MB | Giữ 10 năm (đối soát giá, tái lập kết quả BR-RATE-17) |
| `PriceQuote` (Redis) | ≈ 80.000 | ~1,2 KB | ~20 MB RAM | TTL 900 giây, tự hết hạn (BR-RATE-15) |
| `Hold` (Redis) | ≈ 8.000 | ~150 B | ~1,2 MB RAM | TTL theo `channel.holdMinutes`; đối chiếu mỗi 900 giây |
| `payments` | ≈ 20.000 | ~420 B | ~8,4 MB | Giữ 10 năm, không xoá (BR-PAY-09) |
| `refund_requests` | ≈ 900 | ~520 B | ~0,5 MB | Giữ 10 năm |
| `idempotency_keys` | ≈ 60.000 | ~400 B | ~24 MB | Xoá bản ghi hết hạn (24 giờ) bằng job mỗi giờ |
| `notifications` | ≈ 20.000 | ~1 KB | ~20 MB | Giữ 1 năm, sau đó chỉ giữ số liệu tổng hợp |
| `outbox_events` | ≈ 120.000 | ~700 B | ~84 MB | Xoá `PUBLISHED` sau 30 ngày |
| `audit_logs` | ≈ 300.000 | ~900 B | ~270 MB | **Phân mảnh theo tháng**; giữ 5 năm (BR-SYS-04) |
| `occupancy_snapshots` | ≈ 6.600 | ~140 B | ~0,9 MB | (1 dòng cơ sở + 5 dòng loại phòng) × 3 cơ sở × 365; giữ 3 năm |
| `rate_calendars` | ≈ 5.500 | ~180 B | ~1 MB | Giữ 3 năm + toàn bộ dòng đang hiệu lực |
| `channel_allotments` | ≈ 38.000 | ~120 B | ~4,6 MB | 7 kênh × 15 loại phòng × 365; giữ 2 năm |
| `channel_mappings`, `channel_property_settings`, `promotions`, `seasons`, `system_settings` | ≈ 200 | ~150 B | < 0,1 MB | Cấu hình, giữ vô thời hạn |
| `loyalty_transactions`, `guest_notes`, `room_moves`, `room_merges`, `overbooking_cases` | ≈ 9.000 | ~380 B | ~3,4 MB | Giữ 10 năm (vết điều chuyển, bồi thường — UC-REP-04) |
| **Tổng** | **≈ 660.000** | | **≈ 450 MB/năm** (≈ 0,6 GB/năm kể cả chỉ mục) | |

| Chủ đề | Quyết định |
|--------|-----------|
| Dung lượng 10 năm | ≈ 4,5 GB dữ liệu + chỉ mục — gọn trong một máy chủ, chưa cần sharding |
| `audit_logs` là bảng lớn nhất | Phân mảnh khai báo theo tháng (migration 0009); mỗi mảnh áp lại `REVOKE` + trigger; mảnh quá 5 năm detach sang schema lưu trữ lạnh |
| `outbox_events` | Hàng đợi ngắn hạn: xoá `PUBLISHED` quá 30 ngày và `DEAD_LETTER` quá 90 ngày (sau khi xử lý tay) |
| `idempotency_keys` | Bảng chỉ có giá trị trong 24 giờ: job xoá bản ghi hết hạn mỗi giờ; giữ chỉ mục `expires_at` để job quét nhanh |
| Báo cáo (BR-REP-01) | `ADR`, `RevPAR`, công suất, tỷ lệ huỷ và chi phí xử lý quá tải tính **theo đơn vị bán** (DOR theo giường); công thức do BR-REP-01 định nghĩa, báo cáo **không** tự định nghĩa lại |
| Vacuum & bloat | `autovacuum_vacuum_scale_factor = 0.05` cho `room_assignments`, `outbox_events`, `notifications`, `idempotency_keys`; theo dõi `pg_stat_user_tables.n_dead_tup` |
| Sao lưu | PITR + dump logic hằng ngày; RPO ≤ 15 phút, RTO ≤ 4 giờ (BR-SYS-03) |
| Lưu trữ lạnh | Xuất Parquet theo năm cho `booking_status_history`, `notifications` cũ; dữ liệu tài chính **không** rời CSDL quan hệ |
| Kiểm chứng hiệu năng | p95 tra cứu tồn phòng < 800 ms ở 200 người dùng đồng thời; kịch bản 200 yêu cầu giữ cùng một đơn vị bán/đêm phải cho **đúng 1** thành công (NFR-PERF-01, NFR-REL-01) |

---

## 11. Đề xuất bổ sung

Các mục dưới đây **chưa có trong [00 §7](../00-tong-quan.md#7-từ-điển-thực-thể-nguồn-chân-lý-về-định-danh)** (bản đóng băng 136 BR) nhưng cần thiết để CSDL chứa đủ dữ liệu mà quy tắc nghiệp vụ yêu cầu. Đây là **đề xuất**, không tự thêm vào xương sống.

| # | Bổ sung | Loại | Vì sao bắt buộc | BR/NFR |
|---|---------|------|-----------------|--------|
| 1 | `Booking.externalRef` | Cột | Đối soát và chống trùng booking đẩy từ OTA; cặp `(channelId, externalRef)` là khoá duy nhất từng phần | BR-CHAN-03/04 |
| 2 | `BookingRoom.status`, `BookingRoom.cancelledAt` | Cột | Huỷ một phần cần biết phòng/giường nào đã huỷ để phân bổ `refundBase` theo tỷ lệ | BR-CANCEL-19 |
| 3 | `RefundRequest.netRefund` | Cột sinh | BR-CANCEL-05 định nghĩa `netRefund = refundAmount − refundFee` và mọi ngưỡng phê duyệt/báo cáo so trên nó; CSDL nên tính sẵn để không lệch giữa các tầng | BR-CANCEL-05, BR-CANCEL-15 |
| 4 | `OverbookingCase.escalatedAt` | Cột | BR-OVER-16 yêu cầu giữ **mốc leo thang** (đã có `delayReason`) cho báo cáo UC-REP-04 | BR-OVER-16 |
| 5 | `Guest.anonymizedAt` | Cột | Ẩn danh hoá theo yêu cầu khách, không xoá cứng hồ sơ | BR-CRM-05, NFR-COMP-01 |
| 6 | `Property.latitude`, `Property.longitude` **(tuỳ chọn)** | Cột | Bậc 3 của thang điều chuyển hiện **không khả dụng** (ba cơ sở cách nhau 160–300 km; thang vận hành là 1 → 2 → 4). Nếu chủ đầu tư không dự kiến mở cơ sở trong bán kính 15 km thì **bỏ** hai cột và cấu hình bậc 3 thành "không có phương án" | [02 §9.2](../02-nghiep-vu/quy-tac-nghiep-vu.md#92-thang-xử-lý-khi-thiếu-phòng) |
| 7 | `user_property_scopes` | Bảng nối | `User.propertyScope[]` là mảng — cần bảng nối để mọi quan hệ đều có khoá ngoại | BR-RBAC-02 |
| 8 | Enum chưa có trong [00 §7.8](../00-tong-quan.md#78-enum-canonical): `PropertyStatus = ACTIVE\|INACTIVE`, `NotificationStatus = PENDING\|SENT\|FAILED\|CANCELLED`, `LoyaltyTxnType = EARN\|REDEEM\|EXPIRE\|ADJUST`, `HoldStatus = ACTIVE\|RELEASED\|EXPIRED`, `PriceSnapshotKind = ORIGINAL\|RESCHEDULE\|PARTIAL_CANCEL` | Enum | Giá trị đã dùng trong nghiệp vụ nhưng chưa có tên enum chuẩn | BR-PROP-01, BR-SYS-06, BR-CRM-03, 00 §7.3, BR-RATE-16 |
| 9 | `Promotion.channelScope`, `roomTypeScope` hiện thực bằng `text[]` + `CHECK` tập giá trị | Quyết định | Không cần bảng nối cho danh sách ≤ 7 kênh / 5 loại phòng; `CHECK` vẫn ép đúng enum | BR-RATE-10 |
| 10 | `PriceQuote` (Redis) và `Hold` (Redis) không có bảng PostgreSQL | Quyết định | Đều là bản ghi **tạm**: 900 giây và theo `holdMinutes`; nguồn chân lý tương ứng là `price_snapshots` và `bookings.hold_expires_at` | BR-RATE-15, BR-BOOK-07, BR-INV-04, NFR-REL-02 |
| 11 | Mã lỗi `E_AUTH_FORBIDDEN` (ánh xạ `42501` từ trigger/`REVOKE`) và `E_BOOK_NOT_DELETABLE` | Mã lỗi | Cần để tầng API trả đúng 403/409 thay vì 500; `DesignApi` cần xác nhận tên trong [04/api](api.md) §4.2 | BR-SYS-01, BR-BOOK-14/17 |

---

## Tham chiếu

- [00 — Tổng quan dự án](../00-tong-quan.md) — từ điển thực thể §7, enum §7.8, quyết định công nghệ §9
- [02 — Quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) — **136 quy tắc BR** (nguồn chân lý, gồm `BR-REP-01`)
- [02 — Quá tải, ghép & đổi phòng](../02-nghiep-vu/qua-tai-ghep-doi-phong.md) — thang xử lý, ghép phòng, walk-out
- [02 — Chính sách huỷ & hoàn cọc](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) · [02 — Động giá](../02-nghiep-vu/dong-gia.md)
- [03 — Mô hình miền](../03-phan-tich/mo-hinh-mien.md) · [03 — Mô hình động](../03-phan-tich/mo-hinh-dong.md) — máy trạng thái `Booking`, phối hợp khoá khi giữ chỗ
- [04 — Kiến trúc](kien-truc.md) — ADR-003 (PostgreSQL 16 + Prisma), ADR-004 (Redis), cổng ra `UnitOfWork`/`OutboxPort`
- [04 — Thiết kế lớp](thiet-ke-lop.md) — `AvailabilityCalculator`, `PricingEngine`, `OverbookingPlanner`
- [04 — API](api.md) — mã lỗi `E_*` (§4.2), idempotency, webhook
- [04 — Thiết kế màn hình](thiet-ke-man-hinh.md) — lưới tồn phòng, bảng điều khiển quá tải
- [05 — Kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md) — 200 yêu cầu đồng thời, diễn tập phục hồi §8.4
- [05 — Quy tắc kỹ thuật](../05-ke-hoach/quy-tac-ky-thuat.md) — chuẩn code, quy trình migration
- [01 — Yêu cầu phi chức năng](../01-yeu-cau/yeu-cau-phi-chuc-nang.md) — NFR-REL-01/02/04, NFR-SEC-04, NFR-COMP-02, NFR-LOC-02/03/04
- [06 — Ma trận truy vết](../06-truy-vet/ma-tran-truy-vet.md) — BR → UC → API → Entity → Test
