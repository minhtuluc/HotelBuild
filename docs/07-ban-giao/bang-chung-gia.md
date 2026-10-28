# Bằng chứng đối chiếu giá 5 nguồn + NFR giao diện (HB-187)

**Ngày chạy:** 29/10/2026 · **Môi trường:** Linux 7.2.11 (Fedora 44), Node `v22.23.1`, pnpm `10.34.5`, PostgreSQL `16.15`, Redis `7.4.11` (DB `/14`) · **Nền:** `main` = `9ee00d9`.

Căn cứ: [HB-187](../08-thi-cong/tickets/HB-187-doi-chieu-gia-5-nguon.md), **BR-RATE-17** ([động giá §5](../02-nghiep-vu/dong-gia.md)), **TC-RATE-21**, **NFR-PERF-05** ([yêu cầu phi chức năng](../01-yeu-cau/yeu-cau-phi-chuc-nang.md)), [api.md](../04-thiet-ke/api.md) §3.1.

Sản phẩm của lượt này: [`tests/e2e/price-parity/run.mjs`](../../tests/e2e/price-parity/run.mjs) — dựng **CSDL tạm**, migrate + seed, chạy **API thật** (`tests/e2e/f5/qa-f5-lib.mjs`), build và chạy **hai web ở chế độ `next start`** trỏ API thật, rồi so **từng VND**.

## 1. Kết quả

```
# TỔNG: 15/15 PASS · 0 FAIL · 2 BLOCKED (Android) · 10 kỳ mẫu
EXIT=0   (~26 s, không tính lần build đầu)
```

| Kỳ mẫu | Kênh | Gói giá so | API (VND) | Bề mặt web | Lệch |
|---|---|---|---|---|---|
| S01 giữa tuần · STD | WEB | FLEX7 | 1.300.000 | customer-web 1.300.000 | **0** |
| S02 cuối tuần · DLX | WEB | FLEX7 | 2.200.000 | customer-web 2.200.000 | **0** |
| S03 cuối tuần · SUP (3 đêm) | WEB | FLEX7 | 2.424.000 | customer-web 2.424.000 | **0** |
| S04 cao điểm · FAM | WEB | FLEX7 | 4.320.000 | customer-web 4.320.000 | **0** |
| S05 cao điểm · DLX · 2 phòng | WEB | FLEX7 | 6.534.000 | customer-web 6.534.000 | **0** |
| S06 giữa tuần · STD | WALKIN | FLEX7 | 1.430.000 | operations-web 1.430.000 | **0** |
| S07 cuối tuần · DLX (3 đêm) | WALKIN | SAVER3 | 3.450.000 | operations-web 3.450.000 | **0** |
| S08 cao điểm · SUP | WALKIN | FLEX7 | 2.526.000 | operations-web 2.526.000 | **0** |
| S09 cao điểm · FAM | WALKIN | NONREF | 4.752.000 | operations-web 4.752.000 | **0** |
| S10 cuối tuần · STD · 7 đêm | WALKIN | FLEX7 | 4.766.000 | operations-web 4.766.000 | **0** |

Điều kiện đầu bằng SQL trên CSDL tạm: một mùa `SE-SUM` (hệ số 1.350, priority 10) phủ ngày 30–44 để có nhóm "cao điểm"; ngày/loại phòng/kênh/gói và số phòng thay đổi giữa các kỳ. Seed có sẵn 3 cơ sở, 15 loại phòng, 55 phòng, 7 kênh, 4 gói giá (không có `seasons`/`promotions`/`rate_calendars` mặc định).

**Customer web tự chọn gói đầu tiên** danh mục `/rate-plans` trả về (`room-detail-screen.tsx`), nên với 5 kỳ WEB, API được gọi với **đúng gói mà màn hình dùng** (FLEX7) — không phải gói ghi trong nhãn mẫu. Đây là chủ ý: phép so phải cùng bộ đầu vào (BR-RATE-17).

## 2. NFR giao diện

| Chỉ số | Ngưỡng | Đo được | Kết quả |
|---|---|---|---|
| Lưới tồn 30 ngày (55 phòng) | ≤ 200 KB sau gzip | **791 byte** gzip (`GET /inventory/grid?propertyId=…&from=…&to=…`, HTTP 200) | **PASS** |
| Walk-in 20 lượt báo giá | ticket chỉ yêu cầu **đo** (không đặt ngưỡng) | p50 **24,2 ms** · p95 **28,3 ms** · max 28,3 ms (20 lượt liên tiếp, `POST /quotes` kênh WALKIN) | ghi nhận |

## 3. Nguồn không đo được (BLOCKED)

| Nguồn | Lý do | Bằng chứng |
|---|---|---|
| **customer-android** | Không có `adb`/emulator trên máy; app Expo không có mục tiêu web | `adb` không tồn tại; `apps/customer-android/package.json` chỉ có `expo start --android` / `expo export --platform android` |
| **operations-android** | như trên | như trên |
| Nhánh "khuyến mãi" của AC1 | **Không bề mặt nào nhận mã khuyến mãi**: customer-web cố định kênh `WEB`, không có ô mã trong `parseCriteria`/`RoomDetailScreen`; ops-web không có bước nhập mã | `search-params.ts`, `room-detail-screen.tsx`, `new-booking-steps.tsx` |

Bù cho hai nguồn Android (không phải bằng chứng parity): bộ unit của **cả hai app xanh** (customer 132 ca, operations 378 ca) và cả hai dùng chung **`@pinehill/api-client`** (customer 15 tệp, operations 20 tệp) — tức cùng client/hợp đồng giá với web, không có công thức giá riêng. Parity **trên thiết bị** vẫn phải chạy lại khi có emulator.

## 4. Phát hiện (ngoài phạm vi sửa của ticket)

**F-GIA-01 (P0, chặn vận hành thật — phát hiện khi chạy):** operations-web gửi `POST`/`PUT` tới BFF `/api/session/sys/**` **thiếu header `x-session-request`**, nên BFF trả **403 CSRF** khi giao diện chạy với **API thật**:

```
# ops resource: 403 http://127.0.0.1:3102/api/session/sys/quotes
# ops quote headers: {"authorization":"yes"}      ← không có origin?, không có x-session-request
```

- Nguồn: `apps/operations-web/src/lib/ops-session.ts` dựng `ApiClient` với `fetchImpl: opsFetch(...)`; `opsFetch` chỉ kiểm phạm vi tuyến và bearer rồi `fetch(input, init)` — không thêm `x-session-request` (client `session.post` cho login/refresh **có** thêm). `packages/web-session/src/journey.ts` (`csrf`) đòi header này cho mọi phương thức khác `GET`.
- Vì sao lọt: toàn bộ E2E operations-web dùng **API giả** (`page.route`), nơi không có cổng CSRF; các lượt QA trước kiểm API trực tiếp, không qua BFF.
- Đề xuất sửa: thêm `headers.set('x-session-request', '1')` trong `opsFetch` (một chỗ, mọi mô-đun) **hoặc** trong `ApiClient` khi `baseUrl` là BFF; thêm một ca E2E chạy **API thật** cho ít nhất một lệnh ghi (`POST /bookings`). Cần ticket riêng vì chạm `apps/**` ngoài allow HB-187.
- Trong lượt đo này, harness **bơm header ở tầng trình duyệt** (`page.route`) để phần parity còn lại vẫn đo được; không sửa mã sản phẩm.

**F-GIA-02 (thông tin, đã có ở TD-66):** trọng số `price_per_night × nights` (làm tròn xuống) lệch dưới `nights` VND so với Σ dòng phí ROOM; không ảnh hưởng số hoàn đã làm tròn 1.000 trong QA F5.

## 5. Cách tái lập

```bash
pnpm install --frozen-lockfile
DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:5432/pinehill' \
DATABASE_URL='postgresql://app_rw:app_rw_dev@127.0.0.1:5432/pinehill' \
REDIS_URL='redis://127.0.0.1:6379/14' NODE_ENV=development \
node tests/e2e/price-parity/run.mjs
```

- Lần đầu build hai web với `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:4310/api/v1` (địa chỉ cố định) rồi harness chạy reverse proxy `:4310 → API thật của lượt`; các lượt sau đặt `SKIP_BUILD=1`.
- Hai web chạy `next start` (bản phát hành) trên cổng `3101`/`3102`; `SESSION_APP_ORIGIN` đặt theo đúng origin để BFF nhận phiên.
- Harness tự tạo CSDL `hb117_qa_*`, migrate + seed, và **xoá CSDL** khi xong; Redis dùng DB riêng `/14`.
- Không sửa mã sản phẩm; F-GIA-01 chỉ được **bơm header ở trình duyệt** để đo, và được ghi thành phát hiện ở §4.
