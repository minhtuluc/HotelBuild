# Biến môi trường và bí mật theo môi trường (HB-176)

**Phạm vi:** bảng biến × ứng dụng × môi trường × nơi lưu và lịch xoay khoá cho [HB-176](../../08-thi-cong/tickets/HB-176-bi-mat-moi-truong.md) AC1–AC2. Bảng **suy ra từ mã đang có trên `main`** (schema cấu hình zod, `process.env` trong `scripts/` và `apps/*/prisma`, workflow, compose, collector) và đối chiếu với [kiến trúc §7.1](../../04-thiet-ke/kien-truc.md). Tài liệu **không chứa giá trị**: mọi ví dụ là `<placeholder>`.

**Chưa nghiệm thu:** HB-176 còn OPEN. Chưa có staging/production (chờ quyết định hosting HB-174 và IaC HB-175), nên cột "nơi lưu" chỉ nêu **loại nguồn**, chưa gán nhà cung cấp; chưa có lần chạy thật nào. Xem [mục 9](#9-chưa-nghiệm-thu-và-blocked).

## 1. Quy ước

| Ký hiệu | Nghĩa |
| --- | --- |
| **S** | Bí mật: lộ là phải xoay. Không được nằm trong repo, log, bundle trình duyệt/app, ảnh Docker hay tham số dòng lệnh. |
| **C** | Cấu hình không bí mật (hạn mức, nhịp, URL nội bộ): có thể nằm trong biến thường của nền tảng chạy. |
| **P** | Công khai: đi vào bundle trình duyệt/app (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`). **Cấm** đặt bí mật vào biến loại này. |
| **Dev** | Máy lập trình, `.env` cục bộ từ [`.env.example`](../../../.env.example) (`.gitignore` chặn `.env*` trừ tệp mẫu). |
| **CI** | Job GitHub Actions: giá trị tạm của container dịch vụ, không phải bí mật thật. |
| **Stg / Prod** | Staging / production. Chưa tồn tại; cột ghi điều mã **yêu cầu**, không phải trạng thái đã triển khai. |

Loại nguồn bí mật dùng ở cột "Nơi lưu" (nhà cung cấp cụ thể chờ HB-174):

| Mã nguồn | Dùng cho |
| --- | --- |
| **GH-ENV** | Secrets của *GitHub Environment* (`staging`, `production`) — chỉ job triển khai được duyệt mới đọc. |
| **KHO-CHẠY** | Kho bí mật/biến môi trường của nền tảng chạy `api` và `worker` (do HB-174/HB-175 chọn). |
| **KHO-WEB** | Biến môi trường của nền tảng chạy hai web (kiến trúc §7 ghi Vercel; vẫn là quyết định của HB-174/HB-175). |
| **EAS** | EAS Secrets / EAS Environment Variables của hai app Android. |
| **FILE-MOUNT** | Tệp bí mật mount vào container, quyền chỉ đọc (vd. `url_file` của Alertmanager). |

Mã đọc biến ở **một chỗ duy nhất mỗi app** và dừng tiến trình khi thiếu/sai ([kiến trúc §7.5](../../04-thiet-ke/kien-truc.md), NFR-MAIN-05): `apps/api/src/config/env.ts`, `apps/worker/src/config/env.ts`, `apps/{customer,operations}-web/src/config`, `apps/{customer,operations}-android/src/config` (schema dùng chung ở `packages/contracts/src/env.ts`). Lỗi cấu hình chỉ nêu **tên** biến, không in giá trị.

## 2. API (`apps/api`)

| Biến | Loại | Bắt buộc | Dev | CI | Stg / Prod | Nơi lưu (Stg/Prod) | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | S | Có | role `app_rw` local | role `app_rw` tạm | role `app_rw` riêng từng môi trường | KHO-CHẠY | URL chứa mật khẩu ⇒ bí mật. Role runtime không có quyền DDL (QĐ-02 mục 4). Prisma cũng đọc `env("DATABASE_URL")`. |
| `REDIS_URL` | S | Có | `redis://` local | service tạm | `redis://`/`rediss://` có xác thực | KHO-CHẠY | Có thể chứa mật khẩu. Cache/khoá phân tán, không sở hữu bất biến tiền/tồn (kiến trúc §8.3). |
| `JWT_ACCESS_SECRET` | S | Có | sinh ngẫu nhiên trong `.env` | giá trị thử nghiệm | khoá riêng, ngẫu nhiên, khác nhau giữa Stg và Prod | KHO-CHẠY | Ký/xác thực access token HS256 **và** ký liên kết tải tệp xuất (HMAC). Mã chỉ kiểm `min(1)`, **không ép độ dài/entropy** — người vận hành phải sinh ≥ 48 byte ngẫu nhiên. |
| `JWT_REFRESH_SECRET` | S | Có (schema) | như trên | giá trị thử nghiệm | như trên | KHO-CHẠY | **Hiện không có đường mã nào đọc** (xem mục 8, phát hiện F1). Refresh token là 32 byte ngẫu nhiên, CSDL chỉ lưu SHA-256. |
| `BUSINESS_TIMEZONE` | C | Có | `Asia/Ho_Chi_Minh` | giá trị tương tự | `Asia/Ho_Chi_Minh` (BR-GEN-05) | KHO-CHẠY | Kiểm bằng `Intl.DateTimeFormat`. |
| `IDEMPOTENCY_TTL_HOURS` | C | Không (mặc định 24) | — | — | giữ 24 (BR-GEN-08) | KHO-CHẠY | |
| `EXPORT_DIR` | C | Không | để trống ⇒ thư mục tạm | — | **phải trùng** giá trị với worker, cùng ổ đĩa | KHO-CHẠY | Worker ghi tệp báo cáo, API đọc để phục vụ link tải (HB-163). |
| `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` | S (mã đối tác là định danh, khoá băm là bí mật) | Có khi bật VNPay | thiếu ⇒ bộ mô phỏng | thiếu ⇒ bộ mô phỏng | **bắt buộc đủ bộ**: còn cổng ở chế độ mô phỏng thì API dừng khi `NODE_ENV=production` | GH-ENV (nạp vào) → KHO-CHẠY | Đủ cả hai ⇒ chế độ thật chỉ bằng cấu hình (`pay/psp/settings.ts`). |
| `VNPAY_PAYMENT_URL` | C | Không | mặc định sandbox | — | URL cổng thật của PSP | KHO-CHẠY | Phải `https:`. |
| `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` | S | Có khi bật MoMo | thiếu ⇒ mô phỏng | thiếu ⇒ mô phỏng | **bắt buộc đủ bộ** như VNPay | GH-ENV → KHO-CHẠY | Thiếu một trong ba ⇒ chế độ mô phỏng. |
| `MOMO_PAYMENT_URL` | C | Không | mặc định sandbox | — | URL cổng thật | KHO-CHẠY | Phải `https:`. |
| `PAYMENT_PSP_CALLBACK_BASE_URL` | C | Dev: không; **Prod: bắt buộc** | loopback `HOST:PORT` | — | gốc URL công khai PSP gọi về | KHO-CHẠY | Thiếu ở production ⇒ API dừng. Không suy từ dữ liệu của khách. |
| `PAYMENT_RETURN_URL_ORIGINS` | C | Không | để trống | — | danh sách origin hợp lệ của `returnUrl`, phẩy ngăn cách | KHO-CHẠY | Rỗng cả hai nguồn ⇒ production dừng. |
| `PSP_ALLOW_MOCK` | C (cờ kiểm thử) | Không | `true` chỉ khi test | `true` chỉ trong test | **không đặt** | — | `true` cho phép bộ mô phỏng xác nhận sự kiện tiền. Đặt ở Stg/Prod là lỗi cấu hình. |
| `NODE_ENV` | C | Không (đặt bởi Dockerfile) | `development` | `development` | `production` (đã cứng trong `docker/*.Dockerfile`) | image | Quyết định hàng rào fail-fast của PSP. |
| `LOG_LEVEL` | C | Không (mặc định `info`) | `info` | — | `info` | KHO-CHẠY | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | C | Không | trống ⇒ không xuất | — | URL collector nội bộ | KHO-CHẠY | Nếu endpoint có kèm thông tin xác thực thì coi là **S**. API/worker xuất đủ span, việc lấy mẫu ở collector. |
| `OTEL_SAMPLE_RATIO` | C | Không | `1` | — | trong `[0,1; 1]` | KHO-CHẠY | Chỉ đặt cờ sampled của W3C; không bỏ span. |
| `PORT`, `HOST` | C | Không | `3000`, `127.0.0.1` | — | `HOST=0.0.0.0`, `PORT=3000` (đã cứng trong `docker/api.Dockerfile`) | image | |

## 3. Worker (`apps/worker`)

Worker đọc `DATABASE_URL`, `REDIS_URL`, `EXPORT_DIR`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT` như API (cùng ý nghĩa, cùng nguồn; `NODE_ENV=production` đã cứng trong `docker/worker.Dockerfile`) và thêm:

| Biến | Loại | Bắt buộc | Mặc định / Stg-Prod | Nơi lưu | Ghi chú |
| --- | --- | --- | --- | --- | --- |
| `NOTI_SMTP_URL` | S | Có khi gửi email thật | trống ⇒ kênh EMAIL lỗi `EMAIL_NOT_CONFIGURED` (không giả vờ đã gửi) | KHO-CHẠY | `smtp://`/`smtps://`; phần xác thực nằm trong URL ⇒ bí mật. Dev dùng Mailpit local. |
| `NOTI_SMTP_FROM` | C | Có khi gửi email thật | trống ⇒ như trên | KHO-CHẠY | Địa chỉ gửi (3–200 ký tự). |
| `ENABLE_REPEATABLE_SCHEDULERS` | C | Không | mặc định `false` ⇒ **không đặt lịch định kỳ** (quét hết hạn giữ chỗ, outbox, no-show, cảnh báo… không tự chạy); phải là `true` ở Stg/Prod | KHO-CHẠY | Lịch được đặt bằng `upsertJobScheduler` theo id nên bật ở nhiều bản sao không nhân lịch (`worker-app.ts`). Quên bật là lỗi vận hành âm thầm — đưa vào checklist triển khai của HB-175. |
| `WORKER_CONCURRENCY` | C | Không | `5` (1–64) | KHO-CHẠY | |
| `SHUTDOWN_TIMEOUT_SECONDS` | C | Không | `15` | KHO-CHẠY | |
| `HOLD_EXPIRY_INTERVAL_SECONDS`, `HOLD_EXPIRY_BATCH_SIZE`, `HOLD_RECONCILE_INTERVAL_SECONDS`, `HOLD_RECONCILE_MAX_KEYS` | C | Không | `30`, `100`, `900`, `1000` | KHO-CHẠY | BR-BOOK-18, BR-SYS-02. |
| `OUTBOX_RELAY_INTERVAL_SECONDS`, `OUTBOX_RELAY_BATCH_SIZE`, `OUTBOX_RELAY_LEASE_SECONDS`, `OUTBOX_RELAY_RETRY_BASE_SECONDS`, `OUTBOX_RELAY_RETRY_MAX_SECONDS` | C | Không | `5`, `50`, `30`, `30`, `900` | KHO-CHẠY | Trần 5 lượt thất bại là hằng BR-CHAN-07, không cấu hình. |
| `EXPORT_CLEANUP_INTERVAL_SECONDS` | C | Không | `900` | KHO-CHẠY | |
| `REFUND_PAYOUT_INTERVAL_SECONDS`, `_BATCH_SIZE`, `_LEASE_SECONDS`, `_RETRY_SECONDS`, `_MANUAL_POLL_SECONDS`, `_MAX_ATTEMPTS` | C | Không | `30`, `20`, `60`, `300`, `900`, `5` | KHO-CHẠY | Tiền ra khỏi hệ thống: đổi giá trị là thay đổi vận hành, ghi nhật ký thay đổi. |
| `REFUND_PAYOUT_SIMULATOR` | C (cờ dev/test) | Không | mặc định `false`; **không bật ở Stg/Prod** | — | Chưa có adapter chi hoàn thật của VNPay/MoMo (TD-25); tắt thì worker dừng ở `UNKNOWN`, không tự chi. |
| `NO_SHOW_MARK_INTERVAL_SECONDS`, `NO_SHOW_MARK_TIME`, `NO_SHOW_CATCHUP_DAYS`, `NO_SHOW_BATCH_SIZE` | C | Không | `60`, `23:59`, `7`, `100` | KHO-CHẠY | BR-CANCEL-10. |
| `ALERTS_SCAN_INTERVAL_SECONDS`, `ALERTS_SCAN_BATCH_SIZE` | C | Không | `300`, `50` | KHO-CHẠY | HB-182. |

## 4. Hai web (`apps/customer-web`, `apps/operations-web`)

| Biến | Loại | Bắt buộc | Dev | CI/E2E | Stg / Prod | Nơi lưu | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | P | Có (URL đầy đủ) | `http://127.0.0.1:3000/api/v1` | URL API giả E2E | URL API của môi trường | KHO-WEB (biến thường) | Hai web dùng chung. Chỉ là địa chỉ, không phải bí mật. |
| `NEXT_PUBLIC_FRONT_DESK_CONTACT` | P | Không | trống | — | thông tin liên hệ lễ tân (≤ 160 ký tự) | KHO-WEB | Chỉ `customer-web` đọc (SCR-08). Công khai theo thiết kế: **không đặt dữ liệu cá nhân của nhân viên**. |
| `SESSION_APP_ORIGIN` | C | Không | trống (hoặc origin dev) | origin của app E2E | origin HTTPS đúng của từng web | KHO-WEB | Phải là origin chính xác `http(s)://host[:port]`, không có đường dẫn; sai ⇒ lỗi khi dựng cấu hình phiên. |
| `NODE_ENV` | C | Không | `development` | — | `production` | nền tảng web | Quyết định cờ `development` của phiên cookie. |

Hai web **không** giữ bí mật ở biến môi trường: phiên là cookie do BFF cấp, token nằm ở phía máy chủ API (HB-019).

## 5. Hai app Android (`apps/customer-android`, `apps/operations-android`)

| Biến | Loại | Bắt buộc | Dev | Preview / Prod | Nơi lưu | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | P | Có (URL đầy đủ) | `http://127.0.0.1:3000/api/v1` | URL API của môi trường | EAS (biến môi trường, **không** secret) | Nhúng vào bundle JS. |
| `EXPO_PUBLIC_APP_VARIANT` | P | Có | `development` | `preview` / `production` | EAS (biến thường) | Chỉ nhận ba giá trị này (`mobileEnvSchema`). |

Khoá ký ứng dụng, `EXPO_TOKEN` và mọi bí mật build **không** thuộc hai biến trên; chúng thuộc [HB-189](../../08-thi-cong/tickets/HB-189-phat-hanh-android.md) (EAS Secrets), chưa tồn tại trong repo — xem mục 7.

## 6. Công cụ dòng lệnh, hạ tầng và CI

| Biến | Dùng ở | Loại | Môi trường | Nơi lưu / ghi chú |
| --- | --- | --- | --- | --- |
| `DATABASE_MIGRATION_URL` | `prisma migrate`, `scripts/migrate.mjs`, seed/bootstrap, `pnpm db:dev-roles`, bộ test tích hợp | S | Dev, CI, Stg, Prod (chỉ bước migrate) | Role **chủ sở hữu** có DDL, tách biệt `app_rw`; mã từ chối khi trùng danh tính với `DATABASE_URL`. Production: GH-ENV của job migrate, không nạp vào `api`/`worker` đang chạy. |
| `BOOTSTRAP_OWNER_USERNAME`, `BOOTSTRAP_OWNER_PASSWORD` | `pnpm owner:bootstrap` | S (mật khẩu), C (tên) | Stg, Prod, một lần | GH-ENV hoặc nhập tay; tài khoản tạo ra có `must_change_password = true`, chỉ chạy khi chưa có OWNER hoạt động. Xoá khỏi môi trường ngay sau lần chạy. |
| `SEED_DEV_PASSWORD` | seed tài khoản dev | S | Dev | **Không dùng ở Prod**: mã dừng khi `NODE_ENV=production` mà thiếu; `migration.md` cấm seed dev trên production. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `infra/docker-compose.yml` | S (mật khẩu) | Dev | Mặc định dev nằm trong compose và `.env.example`; **chỉ cho máy lập trình**. Staging/production do IaC của HB-175 quyết. |
| `SMTP_URL` | `.env.example`, `infra/README.md` (Mailpit) | C | Dev | Không có đường mã đọc `SMTP_URL` hôm nay (xem F2). Gửi thật dùng `NOTI_SMTP_URL`. |
| `TEMPO_OTLP_HTTP_ENDPOINT` | `infra/observability/otel-collector.yml` (`${env:…}`) | C (S nếu có token) | Stg, Prod | KHO-CHẠY của collector. |
| `GRAFANA_BASE_URL` | `infra/observability/prometheus-rules.yml` | C | Stg, Prod | Chỉ tạo liên kết trong cảnh báo. |
| Tệp `tech-webhook-url` | Alertmanager `url_file` | S | Stg, Prod | FILE-MOUNT, quyền `0400`; một dòng URL webhook. Không có trong repo. |
| `CI_REQUIRE_SERVICES` | `scripts/test-integration.mjs` | C | CI | Giá trị `1` do script tự đặt. |
| `GITHUB_TOKEN` | workflow | S (do GitHub cấp) | CI | Mặc định quyền `contents: read`; mỗi job khai quyền tối thiểu. Hiện **không có** `secrets.*` nào khác được tham chiếu trong `.github/workflows`. |
| Mật khẩu PostgreSQL trong `ci.yml` / `docs-quality.yml` | service container | không phải bí mật | CI | Giá trị tạm của container loopback, đã phân loại ở [quet-bi-mat.md](quet-bi-mat.md); **không dùng lại** cho môi trường thật. |

Biến chỉ của công cụ lập trình/kiểm thử, **không bao giờ đặt ở Stg/Prod:** `SCOPE_BRANCH`, `SCOPE_BASE` (check:scope), `AGENT_QC`, `OOAD_DB`, `GITLEAKS_BIN`, `HB176_VERIFIED_ARCHIVE`, `HB029_CRASH_INPUT`, `E2E_API_BASE_URL`, `E2E_CUSTOMER_WEB_PORT`, `E2E_OPERATIONS_WEB_PORT`, `E2E_APP_ORIGINS`, `E2E_BROWSERS`.

## 7. Lịch xoay vòng và quy trình

Nguyên tắc chung: xoay **ngay** khi nghi ngờ lộ (log, ảnh chụp, lịch sử Git, máy cá nhân của người rời nhóm); ngoài ra xoay định kỳ theo bảng. Người chịu trách nhiệm là **chủ dự án** (cấp/thu hồi khoá ở bên thứ ba) cùng **lead** (cập nhật kho bí mật và triển khai); kỹ sư không lưu khoá cá nhân. Chu kỳ là **đề xuất** chờ chủ dự án duyệt cùng HB-174. Xoay xong phải ghi nhật ký (ngày, khoá nào, ai) ở chỗ vận hành chung, **không ghi giá trị**.

| Bí mật | Chu kỳ đề xuất | Mã hỗ trợ xoay không gián đoạn? | Quy trình và hệ quả |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | 90 ngày hoặc ngay khi nghi lộ | **Không có khoá kép.** `signAccessToken`/`verifyAccessToken` chỉ nhận một khoá, không có `kid`. | Sinh khoá mới (≥ 48 byte ngẫu nhiên) → cập nhật KHO-CHẠY → khởi động lại **toàn bộ** bản sao API cùng lúc. Hệ quả: mọi access token đang sống (TTL 15 phút) và mọi liên kết tải tệp xuất chưa hết hạn bị từ chối. Refresh token độc lập với khoá này (ngẫu nhiên, lưu băm trong CSDL) nên phiên 7 ngày không mất: web và app lấy token mới bằng refresh. Các màn của `operations-android` dùng client "ghim token" không tự refresh nên có thể hiện "phiên hết hạn", người dùng thao tác lại. Làm ngoài giờ cao điểm. Chạy nhiều bản sao với khoá lệch nhau sẽ cho 401 rải rác — đừng cuốn chiếu. |
| `JWT_REFRESH_SECRET` | — | Không áp dụng | Không có đường mã dùng (mục 8, F1). Xoay không có tác dụng bảo mật; đề nghị lead quyết định bỏ khỏi schema bắt buộc hoặc ghi đúng công dụng. Muốn thu hồi phiên: thu hồi theo người dùng/phiên trong CSDL, không phải đổi biến này. |
| `VNPAY_HASH_SECRET`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` | 180 ngày, hoặc theo yêu cầu của PSP, hoặc ngay khi nghi lộ | **Không có khoá kép.** Mỗi cổng giữ một bộ khoá trong bộ nhớ tiến trình (`pay/psp/settings.ts`). | Phải đổi **đồng bộ hai phía** (cổng thương nhân của PSP và KHO-CHẠY) rồi khởi động lại API. Giao dịch đang chờ ký bằng khoá cũ sẽ không xác minh được ở callback (cửa sổ thanh toán 15 phút). Làm khi không còn thanh toán trực tuyến đang chờ, rồi theo dõi callback muộn theo BR-PAY-11; không hướng dẫn khách trả lần hai trước khi đối soát. Không lộ khoá qua log (BR-PAY-04, NFR-SEC-02). |
| Mật khẩu role `app_rw` (trong `DATABASE_URL`) | 180 ngày hoặc khi nghi lộ | **Không**: PostgreSQL một mật khẩu mỗi role; Prisma giữ pool kết nối. | `ALTER ROLE app_rw PASSWORD …` bằng role chủ → cập nhật KHO-CHẠY → khởi động lại `api` và `worker`. Kết nối mới bằng mật khẩu cũ lỗi cho tới khi khởi động lại; làm trong cửa sổ bảo trì. `pnpm db:dev-roles` và hành vi "xoay mật khẩu `app_rw` giữa lượt `pnpm run ci`" là **chỉ dev**; mã từ chối khi `NODE_ENV=production`. |
| Mật khẩu role chủ (`DATABASE_MIGRATION_URL`) | 180 ngày hoặc khi người có quyền rời nhóm | Không cần khoá kép (chỉ dùng ở bước migrate) | Đổi bằng `ALTER ROLE` → cập nhật GH-ENV của job migrate. Không nạp role này vào tiến trình `api`/`worker`. |
| Mật khẩu Redis (trong `REDIS_URL`) | 180 ngày hoặc khi nghi lộ | Không (một thông tin xác thực mỗi URL) | Đổi ở Redis → cập nhật KHO-CHẠY → khởi động lại `api` và `worker`. Redis chỉ là cache/khoá (kiến trúc §8.3) nên mất kết nối tạm thời không mất dữ liệu tiền/tồn, nhưng hàng đợi job dừng trong cửa sổ đổi. |
| `NOTI_SMTP_URL` (thông tin SMTP trong URL) | theo nhà cung cấp SMTP, tối đa 180 ngày | Phụ thuộc nhà cung cấp; mã đọc một URL | Cấp thông tin mới ở nhà cung cấp → cập nhật KHO-CHẠY → khởi động lại worker. Thư gửi lỗi được thử lại tối đa 3 lần (BR-SYS-06) nên cửa sổ ngắn không mất thông báo. Ghi chú: `SMTP_URL` trong `.env.example` hiện không có đường mã đọc (F2). |
| `EXPO_TOKEN`, khoá ký Android | `EXPO_TOKEN`: 90 ngày hoặc khi người giữ rời nhóm; khoá ký: **không xoay định kỳ** | Chưa có workflow EAS trong repo | Thuộc HB-189: token lưu ở GH-ENV, khoá ký ở EAS Secrets (không trong repo); mất khoá ký ảnh hưởng khả năng cập nhật app nên chỉ thay theo quy trình của kho phát hành. |
| Token đẩy ảnh (registry) | 90 ngày, hoặc dùng token phiên do nền tảng CI cấp (không lưu) | Chưa có pipeline | Thuộc HB-177; chọn sau HB-174. Ưu tiên thông tin xác thực ngắn hạn thay vì token dài hạn. |
| Webhook cảnh báo (`tech-webhook-url`) | 180 ngày hoặc khi kênh bị lộ | Có: giá trị nằm trong tệp mount tách khỏi cấu hình | Tạo webhook mới ở kênh nhận → thay nội dung tệp → nạp lại Alertmanager và gửi thử một cảnh báo → thu hồi webhook cũ. |
| Mật khẩu OWNER khởi tạo (`BOOTSTRAP_OWNER_PASSWORD`) | dùng một lần | — | Tài khoản bị buộc đổi mật khẩu ở lần đăng nhập đầu; xoá biến sau khi chạy. |

**Hạn chế đã biết cần chủ dự án chấp nhận hoặc giao việc mã (không thuộc phần tài liệu này):** không có khoá kép cho `JWT_ACCESS_SECRET` và khoá PSP; không ép độ dài khoá JWT; xoay có cửa sổ ngắn bị từ chối token/callback như mô tả.

## 8. Phát hiện khi đối chiếu tĩnh

Không có bí mật nào bị lộ trong repo hay trong biến công khai. Các điểm lệch dưới đây là **tài liệu ↔ mã**, ghi để lead quyết; HB-176 không sửa mã.

| # | Phát hiện | Bằng chứng | Đề xuất |
| --- | --- | --- | --- |
| F1 | `JWT_REFRESH_SECRET` bắt buộc trong schema nhưng không đường mã nào đọc | chỉ xuất hiện ở `apps/api/src/config/env.ts` (và fixture test); refresh token là ngẫu nhiên + SHA-256 (`infrastructure/crypto/refresh-tokens.ts`) | Bỏ khỏi biến bắt buộc hoặc dùng đúng mục đích; đến khi đó vẫn cấp giá trị ngẫu nhiên để API khởi động. |
| F2 | `SMTP_URL` trong `.env.example` và `infra/README.md` không có đường mã đọc; mã dùng `NOTI_SMTP_URL`/`NOTI_SMTP_FROM` (worker) | grep `SMTP_URL` toàn repo | HB-028 dự định thêm bộ gửi của API đọc `SMTP_URL` (và `GUEST_WEB_BASE_URL`); cập nhật `.env.example` cùng ticket đó. |
| F3 | Kiến trúc §7.1 liệt kê `OTA_BOOKING_*`, `OTA_AGODA_*`, `OTA_AIRBNB_*`, `NOTI_EMAIL_API_KEY`, `NOTI_SMS_*`, `NOTI_ZALO_OA_*` nhưng mã chưa đọc biến nào trong số đó | schema API/worker | Đồng bộ §7.1 khi F6 (OTA) và nhà cung cấp SMS/Zalo có thật; tài liệu này chỉ liệt kê biến mã **đang đọc**. |
| F4 | Kiến trúc §7.1 chưa có các biến đã có trong mã: `EXPORT_DIR`, `NOTI_SMTP_URL`, `NOTI_SMTP_FROM`, `PAYMENT_*`, `PSP_ALLOW_MOCK`, `VNPAY_PAYMENT_URL`, `MOMO_PAYMENT_URL`, `HOST`, `PORT`, các biến nhịp của worker | so sánh hai nguồn | Lead cập nhật §7.1 (ngoài phạm vi `allow` của HB-176). |
| F5 | Khoá JWT chỉ kiểm `min(1)` | `apps/api/src/config/env.ts` | Cân nhắc ép độ dài tối thiểu ở production (việc mã). |
| F6 | `NEXT_PUBLIC_FRONT_DESK_CONTACT` là biến công khai nhưng nội dung do vận hành nhập | `apps/customer-web/src/config/index.ts` | Chỉ nhập số/địa chỉ liên hệ chung của khách sạn; đã ghi ở mục 4. |

Kiểm ngược tiền tố công khai: các biến `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` mã đọc là `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_FRONT_DESK_CONTACT`, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_APP_VARIANT` — đều là địa chỉ/nhãn, **không có bí mật**.

## 9. Chưa nghiệm thu và BLOCKED

- **Staging/production chưa có** (HB-174 quyết hosting, HB-175 IaC): chưa điền được "nơi lưu" cụ thể, chưa thể chạy thật hay diễn tập xoay khoá. AC "chạy thật trên staging, log trong PR" là **BLOCKED**.
- **Chưa có kho bí mật thực** (GitHub Environments `staging`/`production`, EAS Secrets): cần chủ repo/dự án tạo; tài liệu này không tạo gì ngoài repo.
- **Lịch xoay chờ duyệt:** chu kỳ ở mục 7 là đề xuất; cần chủ dự án duyệt. Job `gitleaks` đã có ([quet-bi-mat.md](quet-bi-mat.md)) nhưng chưa từng chạy trên GitHub hosted, và branch protection do chủ repo quản trị.
- **Chưa có kiểm tự động** đối chiếu bảng này với schema (tệp `tests/**` nằm ngoài `allow` của HB-176). Cách kiểm lại bằng tay: liệt kê khoá của `apiEnvSchema`/`workerEnvSchema` và đối chiếu cột "Biến"; rà `process.env` ngoài `src/config` bằng `node scripts/check-frontend-imports.mjs` (cho web/Android) và `grep -rn "process.env" apps/api/src apps/worker/src`. Đề xuất lead giao một ca test "mọi khoá schema đều có dòng trong tài liệu" cho ticket kế tiếp.
- **Hai web và hai app Android:** chưa có cấu hình dự án trên nền tảng web, chưa có `eas.json`/workflow EAS (HB-189 làm song song).
