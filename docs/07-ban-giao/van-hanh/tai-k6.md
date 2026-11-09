# Kiểm thử tải k6 (HB-184)

Bộ kịch bản nằm ở `tests/load/` và hiện thực kế hoạch kiểm thử §7. Toàn bộ dữ liệu là dữ liệu giả.

| Tệp | Kịch bản | Ca kiểm thử / NFR |
| --- | --- | --- |
| `kb-a-tim-phong.js` | KB-A, 200 VU, 10 phút: 70% tra tồn (công khai + lưới 30 ngày), 20% báo giá, 10% tra booking, 1% giữ chỗ rồi bỏ dở | TC-INV-10 · NFR-PERF-01/02/03 · NFR-REL-02 |
| `kb-b-phong-cuoi.js` | KB-B: 200 khách cùng giành **một** đơn vị cuối của một đêm, bùng ở giây thứ 5, xen 20 webhook OTA đã ký. Lặp 5 lần, mỗi lần một đêm khác | TC-INV-03 · NFR-REL-01 · NFR-PERF-05 |
| `kb-c-bao-cao.js` | KB-C, 10 phút: 150 VU mở báo cáo 90 ngày + 50 VU thao tác thường | TC-REP-04 · NFR-PERF-04 |
| `dot-bien-600.js` | Đột biến 600 VU trong 5 phút, hỗn hợp như KB-A | NFR-PERF-03 (5xx < 1%) |
| `bat-bien.sql` | Sau lượt chạy: BB-01 (0 bán trùng), hold hết hạn đã giải phóng ≤ 60 giây, tiền không âm | §7.3 hàng 5/7 |
| `chay-cuc-bo.mjs` | Runner cục bộ: dựng CSDL tạm + API/worker thật, sinh dữ liệu, chạy k6 qua podman/docker, chạy bất biến | — |

## Chạy

```bash
source lead-env.sh && pnpm db:dev-roles
REDIS_URL=redis://127.0.0.1:6379/10 node tests/load/chay-cuc-bo.mjs
# chạy nhanh để thử: LOAD_ONLY=kb-a,kb-b DURATION=20s VUS=20 LOAD_GUESTS=20
```

Kết quả nằm ở `tests/load/results/<lượt>-<kịch bản>.log` (gitignore). Runner thoát mã 1 khi có ngưỡng k6 hoặc bất biến không đạt.

### Giới hạn khi chạy cục bộ

Mọi VU đều đi từ `127.0.0.1`, nên:

- `GET /inventory/availability` chạm hạn mức công khai 120 lượt/phút/IP và phần lớn bị **429**. 429 được đếm riêng (`rate_limited`), không tính là lỗi. p95 chỉ đo trên phản hồi 200.
- Hạn mức đăng nhập/đăng ký 10 lượt/phút/IP: khi chuẩn bị dữ liệu, runner xoá bộ đếm `auth:ip:*` trong Redis DB riêng của lượt tải để mô phỏng nhiều IP. Runner không sửa mã sản phẩm.

Trên staging, k6 phải chạy từ nhiều IP, hoặc sau proxy có `trustProxy` (HB-175), thì mới đo được tra tồn công khai ở 200 VU.

## Trạng thái

- **Lượt staging giống production: BLOCKED.** Lượt này phụ thuộc HB-175 (IaC/proxy/TLS), việc nằm ngoài phạm vi được giao. Chưa có số đo staging, chưa có dashboard HB-181 đi kèm.
- Số đo dưới đây là **cục bộ**, chỉ dùng để so trước/sau một thay đổi. Không dùng để kết luận đạt NFR.

### Lượt cục bộ 09/11/2026

**Cấu hình**

- Máy dev 8 nhân/16 luồng; PG 16.15 và Redis 7.4.11 chạy container.
- **Một** tiến trình API, một worker; pool Prisma 50 (`QA_DATABASE_PARAMS`, mặc định của runner).
- Mã: `main` 059cdd8 + #276 (HB-225) + #277 (HB-228) + #278 (HB-229).

**Lỗi tìm ra nhờ lượt tải (đều đã có PR)**

| Phát hiện | Bằng chứng | Sửa |
| --- | --- | --- |
| Bế tắc pool ở tuyến khách `@Idempotent` (`/holds`, `/bookings`, `/payments/online`, `/quotes`): mỗi lệnh xin connection thứ hai bên trong transaction | `main`, 20 VU: KB-B có cả 20 hold trả 500 sau 10,08 s. 200 VU: 500 hàng loạt ở `POST /quotes` | HB-228 (#277) |
| Worker sập (`Connection is closed`, BullMQ đóng `Queue` lúc kết nối còn khởi tạo) ⇒ không còn ai giải phóng hold hết hạn | REL-02 đỏ: 175 rồi 543 hold quá hạn | HB-229 (#278) |
| Pool Prisma mặc định (17) bão hoà | Spike 2 phút trên DB sạch: pool 17 cho 21,4% 5xx / 187 rps; pool 50 cho 0% / 353 rps | Cấu hình, xem [bien-moi-truong.md](bien-moi-truong.md) |

**Số đo (lượt cuối, đủ bản sửa)**

| Kịch bản | Kết quả | Đạt? |
| --- | --- | --- |
| KB-B ×5 (200 VU giành 1 đơn vị) | Đúng **1 thắng / 199 lệnh 409** ở cả 5 lượt, 0 lỗi 5xx. Webhook OTA p95 15–31 ms. Hold p95 0,84–0,92 s | Bán trùng: đạt. OTA ≤ 300 ms: đạt. Ghi tranh chấp < 900 ms: sát ngưỡng, 3/5 lượt đạt |
| KB-A (200 VU, 10 phút, ~120k request) | 5xx 0,0075% (9 lệnh). Tra tồn công khai p95 103 ms (đo trên phản hồi 200; phần còn lại bị 429 vì một IP). Lưới tồn p95 1,57 s, tra booking p95 0,64 s, báo giá p95 1,15 s | Lỗi < 0,1%: đạt. Tra tồn công khai < 800 ms: đạt. Lưới < 800 ms: **không**. API khác < 400 ms: **không** |
| KB-C (150 VU báo cáo 90 ngày + 50 VU thao tác) | Báo cáo p95 34 ms; lưới 217 ms; báo giá 98 ms; tra booking 35 ms; 0 lỗi | Đạt |
| Đột biến 600 VU (sau 30 phút tải, DB đã có dữ liệu tải) | 5xx 19,9–21,9%, gần như toàn `500 E_GEN_SERVICE_UNAVAILABLE` ở `POST /quotes`. Throughput đứng ở ~175 rps | **Không** (< 1%) |
| Bất biến | BB-01 bán trùng 0 · đêm phòng cuối vượt sức chứa 0 · hold quá hạn chưa giải phóng 0 (hạn hold rút còn 2 phút để mọi hold của KB-A hết hạn trong lượt) · tiền âm 0 | Đạt |

**Đọc kết quả**

KB-A ở 200 VU và đột biến 600 VU đều chạm trần **một** tiến trình Node: khoảng 180 rps với hỗn hợp này. Ở 50 VU (KB-C), cùng các truy vấn đó có lưới tồn p95 217 ms và báo giá 98 ms. Vì vậy không có truy vấn nào chậm bất thường; độ trễ tăng là do xếp hàng ở CPU/pool.

Khi quá tải, API trả `500` thay vì `503 + Retry-After` (TD-81).

**Việc trên staging khi HB-175 xong**

- Đặt `connection_limit` theo số replica.
- Chạy ≥ 2 replica API sau proxy có `trustProxy`.
- Chạy k6 từ nhiều IP.
- Đo lại KB-A và đột biến; gắn dashboard HB-181.
