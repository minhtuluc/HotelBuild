# Rà soát kiến trúc hệ thống giữa kỳ — mốc 47% (12/10/2026)

> **Mục đích:** Báo cáo kiểm định độc lập các bất biến kiến trúc cốt lõi tại commit `9cf87b8` (sau khi hoàn thành 91/193 ticket). Dành cho lead (Opus) và đội thi công (Codex, DeepSeek, Gemini) tham chiếu khi rà soát và giao nhận ticket.  
> **Căn cứ:** [Kiến trúc hệ thống](../04-thiet-ke/kien-truc.md), [Quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md), [QĐ-04](../05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md), [Sổ tay lead](../08-thi-cong/so-tay-lead.md).

---

## 1. Các bất biến cốt lõi đã kiểm chứng (ĐANG ĐẠT)

Qua rà soát trực tiếp trên mã nguồn và cơ sở dữ liệu `main`, các chốt chặn kiến trúc trọng yếu nhất đang được bảo toàn:

| Bất biến cốt lõi | Vị trí kiểm chứng trên mã nguồn | Hiện trạng |
|---|---|---|
| **Chống bán trùng phòng tầng DB** | `EXCLUDE USING gist (room_id WITH =, valid_range WITH &&)` trong migration `0001_baseline` | **ĐẠT** — CSDL từ chối giao dịch vi phạm bằng lỗi `23P01`. |
| **Nhật ký kiểm toán bất biến (Append-only)** | `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_rw...` trong migration `0001_baseline` & `0002` | **ĐẠT** — Quyền ghi đè bị tước ở tầng phân quyền PostgreSQL; bản ghi liên kết hash SHA-256. |
| **Nguyên tắc Deny-by-default** | `APP_GUARD` toàn cục trỏ tới `AuthGuard` và `RbacGuard` trong `apps/api/src/app.module.ts` | **ĐẠT** — Không route nào bị hở nếu thiếu `@Public()` tường minh. |
| **Khóa bi quan ở đường ghi (Pessimistic Locking)** | `FOR UPDATE` áp dụng nhất quán ở 12 module lệnh (`pay/ledger`, `prop/room-blocks`, `inv/allotments`, `rate/rate-plans`, `sys/settings`...) | **ĐẠT** — Tránh hoàn toàn race condition khi cập nhật tài nguyên dùng chung. |
| **Transactional Outbox nguyên tử** | `tx.outbox_events.create` gọi bên trong cùng interactive transaction với thay đổi nghiệp vụ | **ĐẠT** — Sự kiện đồng bộ kênh/quá tải cam kết 100% cùng dữ liệu, không sinh sự kiện mồ côi. |
| **Miền thuần túy (Domain Purity)** | `packages/domain` 0 I/O; không có `new Date()` hay `Math.random()` tự do; API lấy giờ qua port `Clock` | **ĐẠT** — Logic tính giá, huỷ cọc, phân bổ hoàn toàn đơn định và độc lập môi trường. |
| **Frontend không chứa luật tiền/tồn** | 4 frontend (`customer-web`, `operations-web`, `customer-android`, `operations-android`) | **ĐẠT** — Chỉ hiển thị `PriceQuote` và trạng thái từ backend; không có logic tính giá nội suy. |
| **Idempotency bền vững** | `apps/api/src/common/idempotency/store.ts` lưu lệnh JSON trên PostgreSQL theo ADR-017 | **ĐẠT** — Chống phát lại/gọi trùng lặp an toàn kể cả khi mất cache Redis. |
| **Bảo mật biến môi trường & bí mật** | Quét toàn bộ repository | **ĐẠT** — Không có file `.env` hay credentials thật bị commit (chỉ có `.env.example`). |

---

## 2. Hai vấn đề chí mạng cần lưu ý (KHÔNG dừng thi công, xử lý theo ticket)

Hai vấn đề dưới đây **không phải lỗi kiến trúc cần đập đi xây lại**, nhưng là rào chắn bắt buộc phải xử lý trước khi kích hoạt trên môi trường thật:

### C1. Worker nền hiện tại vẫn là khung rỗng (`stub`)
* **Hiện trạng mã:** `apps/worker/src/worker-app.ts` đăng ký 5 hàng đợi (`q.hold-expiry`, `q.outbox-relay`, `q.overbooking-scan`, `q.channel-sync`, `q.no-show-mark`), nhưng handler bên trong chỉ ghi log nhận job (`deps.log`), chưa có handler thực thi nghiệp vụ CSDL. File `apps/worker/package.json` hiện cũng chưa cài `@prisma/client` hay `pg`.
* **Hiện tượng tích tụ outbox:** 4 module backend đang đẩy sự kiện vào bảng `outbox_events` đều đặn nhưng chưa có tiến trình relay (thuộc HB-130) để xả ra ngoài.
* **Nguy cơ thực tế:** Nếu kích hoạt chức năng giữ chỗ (HB-076) lên staging trước khi worker giải phóng chỗ (HB-078) chạy thật, phòng bị giữ sẽ không bao giờ được trả lại tồn khả dụng.
* **Biện pháp điều phối:** Gắn điều kiện chặn: **"Không mở cổng giữ chỗ HB-076 trên staging nếu worker HB-078 chưa hoàn thành handler thật."**

### C2. Đường ghi lõi F4 (Quote / Hold / Booking) chưa nối Backend thật
* **Hiện trạng mã:** `app.module.ts` của API hiện chưa nạp các module `quotes`, `holds`, `bookings` thật. Toàn bộ hơn 20 màn hình giao diện khách và quầy của DeepSeek (HB-080…087, HB-102…110) hiện đang chạy trên **API giả** (`tests/e2e/fake-api`).
* **Nguy cơ thực tế:** Mặc dù hợp đồng Zod contracts đã bảo đảm tương thích kiểu dữ liệu (Type-Safety), nhưng các hành vi runtime (thứ tự trả mã lỗi, ETag If-Match, race condition 409/410) cần được kiểm chứng khi ghép với API thật.
* **Biện pháp điều phối:** Ưu tiên Codex hoàn thành chuỗi ticket lõi F4 (`HB-074` ➔ `HB-076` ➔ `HB-077`) để DeepSeek chuyển giao diện từ API giả sang API thật; các bài test QA F4/F5 của Gemini (`HB-088`, `HB-117`) bắt buộc phải chạy trên API thật.

---

## 3. Cảnh báo rủi ro về quy trình Git & CI

* **Tình trạng commit vào `main`:** Từ commit `885613d` (08/10) đến `9cf87b8` (12/10), có **36 commit được đẩy thẳng vào `main` không qua số PR**, so với 18 commit có gắn mã PR (`#nn`). Một số commit ghi nhận merge thẳng tại local.
* **Rủi ro:** Việc đi vòng qua script `pnpm pr:merge` có thể làm vô hiệu hóa hàng rào kiểm tra tự động trước merge khi chưa đủ 3 check CI bắt buộc (xem [Sổ tay lead §4](../08-thi-cong/so-tay-lead.md)).
* **Khuyến nghị:** Cần bảo đảm tab GitHub Actions của nhánh `main` luôn xanh 100% sau các đợt tích hợp cục bộ này.

---

## 4. Danh mục nợ kỹ thuật ghi nhận thêm (Sửa dần sau)

Các vấn đề sau không ảnh hưởng đến tiến độ trước mắt, được chuyển thành nợ kỹ thuật trong [no-ky-thuat.md](no-ky-thuat.md):

| Mã nợ | Vấn đề & Tác động | Trả trước |
|---|---|---|
| **TD-12** | **Thiếu khối REVOKE ở các migration tạo bảng mới sau baseline:** Migration `0004_allotment_scopes` tạo bảng mới nhưng chưa tự thu hồi quyền `UPDATE/DELETE/TRUNCATE` đối với các vai trò `app_rw`. Cần bổ sung rule CI kiểm tra mọi migration có `CREATE TABLE` đều phải chạy khối REVOKE cho bảng append-only/tiền. | Trước đợt migration bảng tiền kế tiếp (HB-091/F5). |
| **TD-13** | **Lệch tài liệu kiến trúc:** `kien-truc.md §1` ghi idempotency lưu ở Redis (thực tế code và ADR-017 dùng PostgreSQL); `§7` ghi "một image Docker" (thực tế có 2 file `api.Dockerfile` và `worker.Dockerfile`). | Đợt rà soát bàn giao HB-192. |
| **TD-14** | **Quyết định kết nối CSDL cho Worker:** Cần chốt hình thức truy cập DB của `apps/worker` (dùng chung Prisma Client export từ api hay tạo Prisma client riêng) trước khi triển khai HB-078 / HB-130. | Khi Codex nhận HB-078. |
| **TD-15** | **Cập nhật trạng thái sổ nợ kỹ thuật:** Các mục TD-04, TD-05, TD-09, TD-10 trong `no-ky-thuat.md` đã được xử lý một phần trong mã (`HB-035`, `HB-036`, `HB-040`), cần được lead đóng lại chính thức. | Mốc nghiệm thu F2 (HB-049). |

---

## 5. Đính chính số liệu tiến độ thực tế

* Các script phân tích commit trước đó đếm `HB-078` và `HB-127` là "Đã hoàn thành" do có commit `fix/feat` nhắc tên. Tuy nhiên qua kiểm tra ruột mã:
  * Commit `HB-078` mới chỉ bổ sung xử lý log lỗi Redis an toàn, luồng logic nghiệp vụ hết hạn giữ chỗ thật sự vẫn đang chờ `HB-076`.
  * Commit `HB-127` mới chỉ định kiểu payload cho BullMQ, chưa có worker quét thật.
* **Số liệu chính xác tính đến commit `9cf87b8` (12/10/2026):**
  * **Đã hoàn thành thực tế:** **89 / 193 tickets (46.1%)** (thay vì 91/193).
  * **Còn lại cần thi công:** **78 tickets kỹ thuật** (14 Codex độc lập + 24 phối hợp A→B + 40 DeepSeek độc lập) + 13 tickets QA + 14 nghiệm thu/dự phòng.
