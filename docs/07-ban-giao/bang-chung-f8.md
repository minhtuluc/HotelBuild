# Bằng chứng QA F8 — báo cáo, thông báo, CRM

**Ngày chạy:** 16/10/2026 · **Môi trường:** Linux 7.2.5 (Fedora 44), Node `v22.23.1`, pnpm `10.34.5`, PostgreSQL 16 (`127.0.0.1:55432`), Redis 7 (`127.0.0.1:56379`) · **Revision:** xem §6.

Căn cứ: [HB-172](../08-thi-cong/tickets/HB-172-qa-f8.md), TC-REP-01…04/TC-NOTI-01…02, [lộ trình §7.10](../05-ke-hoach/lo-trinh-thi-cong-web-android.md), [quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) (BR-REP-01, BR-CANCEL-13, BR-OVER-15), [csdl §3.4–3.6](../04-thiet-ke/csdl.md), [api.md §2.12](../04-thiet-ke/api.md).

Phạm vi: **chạy thật và đối chiếu độc lập** mã F8 đã có trên `main` (báo cáo `modules/rep/reports`, xuất `modules/rep/export`, NOTI `modules/noti`, CRM `modules/crm/guests`). Không sửa mã sản phẩm. Hai tệp bằng chứng nằm trong [`tests/e2e/f8/`](../../tests/e2e/f8):
[`qa-f8-reconcile.mjs`](../../tests/e2e/f8/qa-f8-reconcile.mjs) (đối chiếu số với SQL độc lập + RBAC + CSV) và
[`axe-f8.spec.ts`](../../tests/e2e/f8/axe-f8.spec.ts) (axe trên 7 bề mặt F8).

## 1. Kết quả đã chạy

| Phép kiểm | Lệnh | Kết quả | Giới hạn của bằng chứng |
|---|---|---|---|
| **Số báo cáo ↔ SQL độc lập + RBAC + CSV** | `node tests/e2e/f8/qa-f8-reconcile.mjs` (`DATABASE_MIGRATION_URL`, `REDIS_URL`) | **PASS — 37/37**, exit 0, ~12 giây | Xem §2: một nhánh công thức hoa hồng chưa phủ; “màn hình” là ảnh chụp JSON màn dùng |
| 6 báo cáo REP khớp SQL độc lập | trong script (16 phép kiểm đầu) | **PASS** | CSDL tách riêng `hb172_qa_*` tạo mới + seed, xoá sau lượt chạy |
| RBAC báo cáo (MANAGER không thấy tài chính) | trong script (14 phép kiểm `RBAC …`) | **PASS** — MANAGER 403 với `revenue-by-channel`/`cancellations`/`force-majeure`; ACCOUNTANT 403 với 4 báo cáo vận hành; OWNER 200 | Kiểm ở tầng API (`@Permission` + service), chưa kiểm ẩn/hiện mục menu UI |
| Xuất CSV qua **worker thật** khớp màn hình | `POST /reports/export` → poll `GET /operations/{id}` → tải tệp | **PASS** — worker sinh tệp, thao tác `SUCCEEDED`, CSV 7 cột, từng hàng khớp JSON báo cáo | So với ảnh chụp JSON, không so pixel/định dạng nghìn của UI |
| Typecheck harness E2E | `pnpm typecheck:e2e` | **PASS** | — |
| Định dạng tệp mới | `pnpm exec prettier --check "tests/e2e/f8/**"` | **PASS** | `tests/e2e` không thuộc `pnpm lint` (QĐ-01 §13) nên không có kết quả ESLint cho vùng này |
| E2E Chromium (toàn bộ) | `pnpm test:e2e` | **PASS — 582 ca đạt / 542 bỏ qua** (guard theo nền tảng), exit 0, 1,7 phút | API giả E2E, không phải API thật |
| axe trên 7 bề mặt F8 (Chromium) | `pnpm exec playwright test -c tests/e2e/playwright.config.ts f8/axe-f8.spec.ts` | **PASS — 7/7**, 0 vi phạm serious/critical | Chromium dùng API giả F8 |
| Cổng phạm vi | `pnpm check:scope` | xem §4 | — |
| Kiểm tài liệu | `npm run check:docs` | xem §4 | — |

**Câu SQL độc lập** (viết từ csdl §3 + BR, không sao chép `apps/api/src/modules/rep/reports/queries.ts`; nằm trong tệp, mỗi câu một hằng số):

| Hằng số trong script | Báo cáo | Định nghĩa kiểm |
|---|---|---|
| `SQL_ROOM_NIGHTS` | SCR-52 công suất, ADR/RevPAR | phòng-đêm khả dụng (ACTIVE, DOR theo giường, trừ `room_blocks`) / đã bán (mỗi `booking_rooms` × đêm) / doanh thu ROOM thuần |
| `SQL_CHANNEL_REVENUE` | SCR-53 doanh thu kênh | gộp−hoa hồng theo snapshot mới nhất của booking đã xác nhận/đã ở |
| `SQL_CANCELLATION_RATE` | SCR-54 tỷ lệ huỷ | `CANCELLED ÷ tạo trong kỳ` theo ngày nghiệp vụ VN |
| `SQL_CANCELLATION_TIERS` | SCR-54 hoàn theo bậc | `refund_requests` đã duyệt/đã chi của booking huỷ, loại bất khả kháng |
| `SQL_FORCE_MAJEURE` | SCR-54 bất khả kháng | yêu cầu hoàn gắn cờ `is_force_majeure` trong kỳ |
| `SQL_OVERBOOKING` | SCR-55 quá tải | mỗi ca + chiết khấu ghép + bồi thường walk-out + hỗ trợ đưa đón |

## 2. Chưa chạy (NOT_RUN) và bị chặn (BLOCKED)

| Hạng mục | Trạng thái | Lý do / điều kiện gỡ |
|---|---|---|
| **WebKit/Safari (NFR-USE-04)** | **BLOCKED** | Đã `pnpm exec playwright install webkit` — tải được `webkit-2359`, nhưng chạy thì WebKit không khởi động: gói WPE thiếu thư viện hệ thống `libicu*.so.74`, `libjpeg.so.8`, `libjxl.so.0.8`, `libbacktrace.so.0` (máy Fedora 44 có ICU 77 và jpeg-turbo soname khác). `playwright install-deps` cần `sudo`/`apt` (máy không có `sudo` không mật khẩu). 7 ca `*-webkit` của `axe-f8.spec.ts` **fail** vì lý do môi trường, **không** phải vi phạm sản phẩm; cần máy có đủ phụ thuộc (hoặc CI Ubuntu với `install-deps`) để gỡ |
| Nhánh phân bổ hoa hồng khi số tiền đêm lệch snapshot | **NOT_RUN** | Kịch bản đặt `amount` của mỗi đêm bằng đúng `grossAmount` trong snapshot nên công thức phân bổ theo tỷ lệ rút gọn còn `amount − commissionAmount`. Phần lệch (làm tròn HALF_UP một lần) do test tích hợp HB-162 phủ, không phải bằng chứng này |
| RBAC phía giao diện (ẩn/hiện mục menu, nút xuất) | **NOT_RUN** | `axe-f8.spec.ts` chỉ quét a11y; ca 403 tại màn hình đã có ở `scr52-53`/`scr54-55` trên API giả. Bằng chứng RBAC của lượt này ở tầng API thật |
| NOTI/CRM đối chiếu SQL độc lập | **NOT_RUN** | HB-172 AC1 chỉ yêu cầu số **báo cáo REP**; NOTI/CRM chỉ được quét axe. Chưa có truy vấn độc lập cho hai module này |
| Xuất tệp XLSX | **NOT_RUN** | Lượt này chỉ chạy nhánh CSV |

## 3. Lỗi phát hiện

**Không phát hiện lệch số báo cáo.** 16/16 phép kiểm đối chiếu (SQL độc lập + số tính tay) và toàn bộ phép kiểm RBAC/CSV đều đạt trên dữ liệu HB-172. Không có phát hiện nào cần sửa mã sản phẩm.

Phát hiện quy trình (không phải lỗi sản phẩm): script QA ban đầu dựng dữ liệu vi phạm hai trigger nghiệp vụ thật (`fn_guard_refund_request` bắt yêu cầu hoàn bắt đầu `PENDING`; `fn_guard_refund_approval` bắt người duyệt **khác** người yêu cầu và có phạm vi cơ sở). Đã sửa bằng cách đi đúng chuỗi thao tác (PENDING → `refund_approvals` maker–checker → APPROVED), **không** tắt kiểm.

## 4. Sản phẩm của lượt QA

- [`tests/e2e/f8/qa-f8-reconcile.mjs`](../../tests/e2e/f8/qa-f8-reconcile.mjs) — script Node ESM: tạo CSDL tách riêng, `scripts/migrate.mjs`, `db:seed`, gieo kịch bản, chạy **API + worker thật** (`tsx src/main.ts`), gọi 6 báo cáo, đối chiếu SQL độc lập + số tính tay, kiểm ma trận RBAC, xuất CSV qua worker và so với ảnh chụp JSON; xoá CSDL sau khi chạy.
- [`tests/e2e/f8/axe-f8.spec.ts`](../../tests/e2e/f8/axe-f8.spec.ts) — 7 ca axe (WCAG 2.1 AA) trên SCR-52/53/54/55, SCR-51 (thông báo), SCR-49 (CRM); được Playwright tự nhặt vì `testDir` là `tests/e2e`.

Cổng (chạy trên bản này): `pnpm check:scope` → **đạt** (có cảnh báo `765/400 dòng > max_lines`, lý do ghi ở PR); `npm run check:docs` → **PASS** (1527 liên kết, 81 sơ đồ mermaid, 139 BR/135 FR/53 UC/40 NFR/217 TC).

## 5. Kết luận tự đánh giá

Trong phạm vi allow của HB-172: **AC1 và AC2 đạt** trên API thật + dữ liệu mô phỏng (số khớp SQL độc lập; MANAGER bị chặn khỏi báo cáo tài chính và lệnh xuất; CSV của worker khớp ảnh chụp báo cáo). **AC3 đạt một phần**: Chromium + axe đạt, **WebKit BLOCKED** vì thiếu thư viện hệ thống (§2) — không nhận đạt. Bằng chứng không phủ các nhánh ở §2 (phân bổ hoa hồng lệch, RBAC UI, NOTI/CRM theo SQL, XLSX).

## 6. Revision và cách tái lập

- **Revision:** commit `feat(HB-172)` trên nhánh `ticket/HB-172-qa-f8` (SHA ghi ở PR); bằng chứng này nằm trong cùng commit bàn giao.
- Tái lập: `pnpm install --frozen-lockfile && pnpm products:build` rồi
  `DATABASE_MIGRATION_URL='postgresql://pinehill:pinehill_dev@127.0.0.1:55432/pinehill' REDIS_URL='redis://127.0.0.1:56379' node tests/e2e/f8/qa-f8-reconcile.mjs`
  và `pnpm test:e2e` (thêm `E2E_BROWSERS=chromium,webkit` khi máy có đủ phụ thuộc WebKit).
