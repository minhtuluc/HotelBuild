# 04 — Nhật ký quyết định kiến trúc (ADR)

> Ghi lại **18 quyết định kiến trúc** đã chốt cho hệ thống đặt phòng Pine Hill, khớp bảng "Quyết định công nghệ đã chốt" ở [00 §9](../../00-tong-quan.md). Mỗi ADR theo mẫu: Bối cảnh · Quyết định · Phương án đã cân nhắc · Hệ quả (tích cực/tiêu cực) · Trạng thái · Ngày.
>
> Cách đọc: ADR trả lời "vì sao chọn cái này"; [kien-truc.md](../kien-truc.md) trả lời "hệ thống ráp lại ra sao". Mọi con số nghiệp vụ chỉ định nghĩa ở [02/quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) — ADR tham chiếu mã BR, không chép giá trị.
>
> Quy ước trạng thái: **Đã chấp nhận** (đang hiệu lực) · **Đã thay thế** (có ADR mới thay) · **Đề xuất**. Đổi một quyết định đã chấp nhận phải tạo ADR mới thay thế, không sửa lịch sử. Toàn bộ ADR dưới đây thuộc giai đoạn thiết kế GĐ-2 (12–25/10/2026) của [05/lộ trình](../../05-ke-hoach/lo-trinh.md), trừ ADR bổ sung được ghi rõ ngày rà soát.


Các quyết định ADR-003/004/008/009/010 đọc cùng các bản chốt giao dịch sau đây; các mục bên dưới đã đồng bộ phần bị thay thế.

| ADR | Quyết định hiện hành |
|---|---|
| [ADR-014](ADR-014-giao-dich-ton-phong.md) | Giao dịch cục bộ, khoá thô property/type và quyền sở hữu tồn |
| [ADR-015](ADR-015-quote-policy-bat-bien.md) | Quote Redis; unique acceptance và snapshot giá/policy/commission bất biến |
| [ADR-016](ADR-016-thanh-toan-hoan-tien.md) | Thu muộn, reservation NET, maker–checker và đối soát chi |
| [ADR-017](ADR-017-inbox-outbox-idempotency.md) | Idempotency/inbox bền, ACK theo provider và delivery từng consumer |

---

## Bảng chỉ mục

| ADR | Tiêu đề | Trạng thái | Ngày | Tham chiếu chính |
|-----|---------|-----------|------|------------------|
| ADR-001 | TypeScript 5.x `strict` làm ngôn ngữ duy nhất cho toàn monorepo | Đã chấp nhận | 10/2026 | BR-RATE-17, BR-GEN-01, NFR-MAIN-02 |
| ADR-002 | NestJS 11 (Node 22 LTS) + Fastify adapter cho API | Đã chấp nhận | 10/2026 | NFR-PERF-02, NFR-MAIN-02 |
| ADR-003 | PostgreSQL 16 + Prisma 6 kèm migration SQL thủ công | Đã chấp nhận | 10/2026 | BR-INV-02, BR-INV-03, NFR-REL-01/05 |
| ADR-004 | Redis 7 cho hold, khoá phân tán, cache và hàng đợi BullMQ | Đã chấp nhận | 10/2026 | BR-INV-04, BR-GEN-08, NFR-REL-02 |
| ADR-005 | Next.js 15 App Router + Tailwind + shadcn/ui cho customer/operations web | Đã chấp nhận | 10/2026 | UC-BOOK-01, UC-REP-01/02, NFR-USE-04 |
| ADR-006 | Expo (React Native) + Expo Router cho customer/operations Android | Đã chấp nhận | 10/2026 | UC-FO-01/02/03, NFR-USE-03 |
| ADR-007 | `packages/domain` thuần + `packages/contracts` bằng zod dùng chung | Đã chấp nhận | 10/2026 | BR-RATE-17, BR-CANCEL-01, NFR-MAIN-01 |
| ADR-008 | REST/JSON + OpenAPI 3.1 sinh từ zod, webhook cho OTA và PSP | Đã chấp nhận | 10/2026 | UC-CHAN-03, UC-PAY-02, NFR-MAIN-04 |
| ADR-009 | VNPay + MoMo (sandbox) kèm tiền mặt/chuyển khoản | Đã chấp nhận | 10/2026 | BR-PAY-03/04/08/09, NFR-SEC-02 |
| ADR-010 | JWT (access 15 phút, refresh 7 ngày) + RBAC theo `propertyScope` | Đã chấp nhận | 10/2026 | BR-RBAC-01…06, NFR-SEC-01/05 |
| ADR-011 | Vitest + fast-check, Testcontainers + Supertest, Playwright, Maestro, k6 | Đã chấp nhận | 10/2026 | NFR-REL-01, NFR-MAIN-01/03 |
| ADR-012 | GitHub Actions → Docker (API/worker) + Vercel (2 web) + EAS Build (2 Android) | Đã chấp nhận | 10/2026 | NFR-USE-01, NFR-REL-04 |
| ADR-018 | Một backend chung, bốn frontend deploy độc lập | Đã chấp nhận | 22/09/2026 | NFR-MAIN-04, NFR-USE-01, ADR-005/006 |
| ADR-013 | Sơ đồ Mermaid nằm trong Markdown, lưu cùng mã nguồn | Đã chấp nhận | 10/2026 | [docs/README §3](../../README.md) |

## ADR-001 — TypeScript 5.x `strict` làm ngôn ngữ duy nhất cho toàn monorepo

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-GEN-01, BR-RATE-17, NFR-MAIN-02, [kien-truc.md §5](../kien-truc.md)

**Bối cảnh.** Cùng một đầu vào giá phải cho cùng kết quả trên bốn frontend và API (BR-RATE-17); tiền tệ bắt buộc là số nguyên VND (BR-GEN-01); nhóm 5 người, một học kỳ, phải chứng minh được tính đúng của động cơ giá và chính sách huỷ.

**Quyết định.** Dùng **TypeScript 5.x với `strict: true`** cho backend, worker, bốn frontend và mọi gói chia sẻ; cấm `any` ngầm định; kiểu miền khai báo một lần trong `packages/domain`. Gói chạy trên Node 22 LTS, `tsc --noEmit` là một bước bắt buộc của CI.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| TypeScript `strict` toàn bộ | Một ngôn ngữ cho miền/web/mobile; kiểu tiền và VO chặt; IDE hỗ trợ tốt | Cần kỷ luật `any`, cấu hình build phức tạp hơn | **Chọn** |
| JavaScript + JSDoc | Bớt bước build | Không ép kiểu miền; dễ lệch giá giữa bốn frontend | Loại |
| TypeScript không `strict` | Nhanh lúc đầu | `null`/`undefined` lọt xuống tận runtime; trái NFR-MAIN-02 | Loại |
| Đa ngôn ngữ (Java cho API, TS cho web) | Tận dụng thế mạnh từng nền tảng | Không chia sẻ được động cơ giá — vi phạm BR-RATE-17 | Loại |

**Hệ quả.**
- Tích cực: `Money` là kiểu không thể trộn với `number` thập phân ở mức kiểu; giá và chính sách huỷ chỉ viết một lần; `packages/contracts` sinh kiểu DTO cho cả bốn frontend và backend nên lệch hợp đồng bị bắt lúc biên dịch.
- Tích cực: `strictNullChecks` buộc xử lý tường minh các nhánh `undefined` của dữ liệu không đồng bộ (callback PSP, webhook OTA).
- Tiêu cực: chi phí dựng cấu hình monorepo (đường dẫn, tham chiếu dự án, build theo gói) trả trước ở Sprint 1.
- Tiêu cực: kiểu `zod` và kiểu TS có thể trùng lặp; giảm nhẹ bằng cách suy kiểu từ schema (`z.infer`) chứ không khai báo tay.

## ADR-002 — NestJS 11 (Node 22 LTS) + Fastify adapter cho API

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** NFR-PERF-02, NFR-MAIN-02, [kien-truc.md §3](../kien-truc.md)

**Bối cảnh.** Cần vỏ ứng dụng có tiêm phụ thuộc rõ ràng để trình diễn các mẫu thiết kế hướng đối tượng (Strategy, Chain of Responsibility, State, Adapter + ACL, Observer + Outbox, Process Manager); đồng thời cần ranh giới module đủ chặt để 13 module không phụ thuộc chéo.

**Quyết định.** **NestJS 11 trên Node 22 LTS với `@nestjs/platform-fastify`**. Mỗi module NestJS tương ứng một mã module nghiệp vụ; chỉ phơi facade ở `modules/<mod>/index.ts`; DI token đại diện cho cổng ra (`BookingRepository`, `ChannelAdapter`, `PaymentGatewayAdapter`, `Clock`, `IdGenerator`).

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| NestJS 11 + Fastify | DI và module dựng sẵn; tách rõ controller/service/provider; hiệu năng HTTP tốt | Trừu tượng ẩn; cần kỷ luật để không nhét logic vào controller | **Chọn** |
| NestJS + Express mặc định | Nhiều ví dụ, dễ tra cứu | p95 cao hơn, lớp adapter HTTP chậm hơn | Loại |
| Fastify thuần + tự dựng DI | Nhẹ, kiểm soát tối đa | Tự viết DI, vòng đời, kiểm tra hợp đồng — tốn thời gian vô ích | Loại |
| Express thuần | Quen thuộc nhất | Không có DI/module; dễ sinh phụ thuộc chéo | Loại |

**Hệ quả.**
- Tích cực: DI container là nơi cưỡng chế "phụ thuộc một chiều" — miền và ứng dụng nhận cổng qua constructor, không tự `new` adapter.
- Tích cực: `@nestjs/testing` cho phép thay adapter thật bằng bản giả trong kiểm thử tích hợp mà không đổi mã miền.
- Tiêu cực: decorator và module metadata là kiến thức riêng của framework; thành viên mới cần thời gian làm quen.
- Tiêu cực: Fastify ít hệ sinh thái trung gian hơn Express cho một số tác vụ (ví dụ một số middleware cũ) — phải tự viết.

## ADR-003 — PostgreSQL 16 + Prisma 6 kèm migration SQL thủ công

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-INV-02, BR-INV-03, BR-SYS-01, NFR-REL-01/05, [kien-truc.md §8](../kien-truc.md)

**Bối cảnh.** Bất biến cứng "mỗi **đơn vị bán** `(roomId, bedNo, đêm)` tối đa một `RoomAssignment` đang hoạt động" (`bedNo = 0` = cả phòng, `1..bedCount` = giường DOR) phải được ép ở tầng dữ liệu, không chỉ ở mã ứng dụng (BR-INV-03, BR-PROP-04). Việc kiểm tra tồn và giữ chỗ phải nằm trong một transaction có khoá bi quan (BR-INV-02). `AuditLog` phải append-only ở tầng CSDL (BR-SYS-01).

**Quyết định.** **PostgreSQL 16** làm CSDL duy nhất; **Prisma 6** làm ORM cho truy vấn thông thường; **migration SQL thủ công** trong `infra/sql/` cho những gì Prisma chưa hỗ trợ: tiện ích `btree_gist`, ràng buộc loại trừ ba cột `EXCLUDE USING gist (room_id WITH =, bed_no WITH =, valid_range WITH &&) WHERE (released_at IS NULL)` với `bed_no = 0` nghĩa là cả phòng và `1..bedCount` là giường của DOR, thu hồi `UPDATE`/`DELETE` trên bảng nhật ký, chỉ mục riêng và materialized view báo cáo. Giá cơ bản của một đêm tra theo `priority` giảm dần (`OVERRIDE` → `RATE_PLAN` → `SEASON` → `BASE`) ngay trên `RateCalendar` — không cần thực thể ghi đè riêng (BR-RATE-02).

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| PostgreSQL 16 + Prisma + SQL thủ công | Có ràng buộc loại trừ; sinh kiểu an toàn; ACID cho đa bảng | Phải bảo trì hai đường migration; ràng buộc đặc biệt không hiện trong `schema.prisma` | **Chọn** |
| PostgreSQL + TypeORM | Migration gắn với thực thể | Kiểu yếu hơn, quan hệ eager dễ phát sinh truy vấn ngầm | Loại |
| MySQL/MariaDB | Phổ biến, quen thuộc | Không có ràng buộc loại trừ trên khoảng ngày — bất biến chống trùng không ép được ở CSDL | Loại |
| MongoDB | Linh hoạt schema | Không có giao dịch nhiều bảng mạnh như PG cho ràng buộc chéo; khó ép bất biến khoảng ngày | Loại |
| PostgreSQL + truy vấn SQL thô toàn bộ | Kiểm soát tối đa | Mất an toàn kiểu; chi phí viết lặp lại lớn | Loại |

**Hệ quả.**
- Tích cực: bất biến chống trùng phòng được chứng minh bằng CSDL — kịch bản 200 yêu cầu đồng thời chỉ 1 thành công (NFR-REL-01).
- Tích cực: khoá bi quan trên hàng `properties`/`room_types` có sẵn theo ADR-014 biểu diễn được trong cùng transaction với Unit of Work.
- Tiêu cực: Prisma không sinh được ràng buộc loại trừ, nên migration thủ công là **điểm rủi ro RSK-04** — bắt buộc làm ngay tuần đầu Sprint 1 và có ca kiểm thử tích hợp.
- Tiêu cực: bước sinh client Prisma thêm vào pipeline build; `prisma migrate deploy` phải chạy trước khi tiến trình API khởi động trong CI/CD.

## ADR-004 — Redis 7 cho hold, khoá phân tán, cache và hàng đợi BullMQ

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-INV-04, BR-GEN-08, BR-RATE-15, NFR-REL-02/06, [kien-truc.md §8.3–8.5](../kien-truc.md)

**Bối cảnh.** Hold phải hết hạn tự động và giải phóng trong ≤ 60 giây (BR-INV-04); báo giá có hiệu lực 15 phút (BR-RATE-15); thao tác ghi phải idempotent 24 giờ (BR-GEN-08); hệ thống cần bốn job nền và một outbox relay.

**Quyết định.** **Redis 7** lưu quote bất biến còn hạn và cache ngữ cảnh/hold/kết quả đã commit; **BullMQ** (trên Redis) làm hàng đợi việc nền. Redis **không** là nguồn chân lý: mọi quyết định giữ chỗ, tính tiền và trạng thái booking đều đọc/ghi PostgreSQL; cache chỉ phục vụ hiển thị, báo giá và gia tốc đọc.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Redis 7 + BullMQ | Nhiều vai trò trong một thành phần (khoá, cache, hàng đợi); có sẵn trong `docker-compose`; job có retry/backoff | Thêm một thành phần phải sao lưu và vận hành | **Chọn** |
| Chỉ PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED` cho job) | Ít thành phần hơn | Không có TTL/khoá phân tán; quét job bằng bảng gây tải ghi liên tục | Loại |
| RabbitMQ/Kafka | Mô hình thông điệp mạnh, bền vững | Vận hành nặng cho nhu cầu 55 phòng; không thay được vai trò cache/khoá | Loại |
| Bộ nhớ trong tiến trình | Đơn giản nhất | Mất trạng thái khi khởi động lại; sai khi chạy nhiều tiến trình worker | Loại |

**Hệ quả.**
- Tích cực: Redis phục vụ cache và BullMQ; nguồn hold là `Booking.holdExpiresAt`, idempotency bền ở PostgreSQL. Job quét PostgreSQL vẫn đáp ứng BR-BOOK-18 khi Redis mất; phục hồi queue từ outbox và `event_deliveries` theo ADR-017. Quote còn hạn không bị xoá khi cấu hình đổi (ADR-015).
- Tích cực: BullMQ cho retry có backoff — đáp ứng "thử lại 3 lần rồi cảnh báo" ở đồng bộ kênh (BR-CHAN-07).
- Tiêu cực: phải bật AOF và đưa Redis vào kế hoạch sao lưu, dù không phải nguồn chân lý.
- Tiêu cực: cache tồn phòng có thể lệch thực tế trong tối đa 60 giây; giảm nhẹ bằng quy tắc "mọi đường ghi phải vô hiệu hoá khoá cache liên quan trong cùng transaction phát outbox".

## ADR-005 — Next.js 15 App Router + Tailwind + shadcn/ui cho cả hai web

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** UC-BOOK-01, UC-REP-01/02, NFR-PERF-03, NFR-USE-04, [kien-truc.md §6](../kien-truc.md)

**Bối cảnh.** Có hai bề mặt web khác nhau về đối tượng dùng: customer web (ACT-01 — tìm phòng, báo giá, đặt, trả cọc) và operations web (ACT-04/05/06 — cấu hình, duyệt, báo cáo). Hai app cần release độc lập để giảm blast radius và phân quyền rõ, nhưng vẫn phải chia sẻ contract/client/token.

**Quyết định.** Dùng **Next.js 15 (App Router) + Tailwind CSS + shadcn/ui** cho hai ứng dụng độc lập `apps/customer-web` và `apps/operations-web`; mỗi app có route/layout/auth riêng, gọi API qua `packages/api-client`, dùng DTO từ `packages/contracts` và token từ `packages/ui-web`.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Next.js 15 App Router, một codebase hai route group | Dùng chung component, xác thực, hạ tầng gọi API; SSR tốt cho trang công khai | Ràng buộc quy ước App Router; không tách biên giới thư viện tuyệt đối giữa hai bề mặt | **Chọn** |
| Hai SPA React (Vite) riêng | Tách bạch gọn gàng | Nhân đôi cấu hình, xác thực, component; tốn công sức không sinh giá trị | Loại |
| Remix | Mô hình dữ liệu tốt | Hệ sinh thái UI ít hơn, nhóm chưa quen | Loại |
| Astro | Tốt cho trang tĩnh | Không phù hợp back-office nhiều tương tác | Loại |

**Hệ quả.**
- Tích cực: hai pipeline release độc lập, nhưng cùng contract/version gate và package client để tránh lệch giao thức.
- Tích cực: route group cho phép đặt layout, guard và quy tắc điều hướng khác nhau mà không tách dự án.
- Tiêu cực: một lỗi build của back-office chặn cả web khách cùng pipeline — giảm nhẹ bằng kiểm thử Playwright tách theo route group.
- Tiêu cực: cần kỷ luật để miền thuần không bị nhập vào bundle máy khách một cách vô ý (kiểm tra bundle trong CI).

## ADR-006 — Expo (React Native) + Expo Router, phát hành Android qua EAS Build

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** UC-FO-01/02/03, BR-RBAC-05, NFR-USE-03, [kien-truc.md §7](../kien-truc.md)

**Bối cảnh.** Khách cần customer Android cho tìm/đặt/thanh toán; lễ tân, quản lý và buồng phòng cần operations Android cho check-in, check-out, đổi phòng và trạng thái buồng. Máy phát triển không có macOS/Xcode; yêu cầu hỗ trợ Android 9+ (API 28) và không mất dữ liệu khi mất mạng (NFR-USE-03). iOS nằm ngoài phạm vi ([00 §3.2](../../00-tong-quan.md)).

**Quyết định.** **Expo (React Native) + Expo Router** cho hai ứng dụng `apps/customer-android` và `apps/operations-android`, mỗi app có application ID/pipeline EAS riêng; bản vá chỉ-JS phát qua EAS Update. Cả hai dùng `packages/api-client`/`packages/contracts`, secure storage và không đọc CSDL trực tiếp.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Expo + Expo Router, EAS Build | Không cần Xcode; phát hành APK nhanh; chia sẻ TypeScript | Giới hạn khi cần mô-đun native riêng; kích thước app lớn hơn | **Chọn** |
| React Native CLI thuần | Kiểm soát native tối đa | Vẫn cần chuỗi công cụ Android/Gradle đầy đủ, tốn thời gian | Loại |
| Kotlin native | Trải nghiệm mượt nhất | Viết lại toàn bộ, không chia sẻ được gì với web/API | Loại |
| Flutter | UI nhất quán, hiệu năng tốt | Thêm ngôn ngữ (Dart) cho một nhóm đã dùng TypeScript | Loại |
| PWA thay app | Không cần phát hành | Camera/quét mã, hàng đợi ngoại tuyến và thông báo đẩy kém tin cậy hơn | Loại |

**Hệ quả.**
- Tích cực: cả hai Android nhận cùng `PriceQuote`/policy snapshot từ backend, nên giá khách và giá vận hành khớp web (BR-RATE-17).
- Tích cực: EAS Build tạo APK trong CI, không cần máy cấu hình Android SDK; phù hợp mốc M7 và M8 của [05/lộ trình](../../05-ke-hoach/lo-trinh.md).
- Tiêu cực: một số thao tác tài chính vẫn phải nhập lại PIN 6 số theo BR-RBAC-05, làm tăng ma sát thao tác của lễ tân.
- Tiêu cực: hàng đợi cục bộ khi mất mạng cần thiết kế riêng (lưu lệnh chờ + phát lại idempotent) và là hạng mục dễ bị cắt khi trễ tiến độ.

## ADR-007 — `packages/domain` thuần + `packages/contracts` bằng zod dùng chung

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-RATE-01, BR-RATE-17, BR-CANCEL-01, NFR-MAIN-01/05, [kien-truc.md §5](../kien-truc.md)

**Bối cảnh.** Động cơ giá áp sáu hệ số theo thứ tự cố định và làm tròn từng đêm (BR-RATE-01); chính sách huỷ phải lấy từ dữ liệu bậc mốc, cấm `if/else` cứng theo gói giá (BR-CANCEL-01); cùng đầu vào phải ra cùng kết quả trên bốn frontend và API (BR-RATE-17). Đây là phần được đánh giá cao nhất của môn học nên phải kiểm thử được ở mức hàm thuần.

**Quyết định.** Tách **`packages/domain`** — chỉ chứa `PricingEngine`, `CancellationPolicyEngine`, `AvailabilityCalculator`, `OverbookingPlanner`, các Value Object (`Money`, `StayPeriod`, `DateRange`, `ChannelContext`, `PhoneNumber`), `BookingState` và lỗi miền; **không I/O**, không phụ thuộc NestJS/Prisma/HTTP/Redis, thời gian và mã định danh truyền vào qua tham số. Tách **`packages/contracts`** — schema `zod` cho DTO và mã lỗi `E_<MOD>_<TÊN>`, có thể phụ thuộc `zod` và kiểu của miền, không phụ thuộc framework.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Gói miền thuần + gói hợp đồng zod | Một nguồn sự thật cho giá/huỷ; kiểm thử hàm thuần, chạy thuộc tính; bốn frontend dùng chung contract | Phải giữ kỷ luật "không I/O"; đồng bộ phiên bản gói khi phát hành mobile | **Chọn** |
| Sao chép logic giá vào từng ứng dụng | Không cần gói chung | Năm bản logic lệch nhau — vi phạm trực tiếp BR-RATE-17 | Loại |
| Chỉ tính giá ở máy chủ, client hiển thị kết quả | Một nguồn duy nhất | Mọi thao tác nhập liệu đều phải gọi mạng; trải nghiệm quầy chậm và phụ thuộc kết nối | Loại |
| Gói "shared" chung cả ORM, tiện ích, UI | Tiện trước mắt | Miền lẫn hạ tầng; phá vỡ luật phụ thuộc một chiều của kiến trúc lục giác | Loại |

**Hệ quả.**
- Tích cực: bốn lớp lõi đạt được mục tiêu phủ nhánh ≥ 90% và được kiểm thử bằng `fast-check` (NFR-MAIN-01); các bất biến như "hoàn không vượt số đã trả" kiểm được bằng thuộc tính.
- Tích cực: đổi quy tắc nghiệp vụ chỉ sửa một chỗ, và ca kiểm thử miền chạy trong vài giây không cần CSDL.
- Tiêu cực: `packages/domain` bị nhập vào bundle mobile làm tăng kích thước APK; giảm nhẹ bằng tree-shaking và chỉ xuất những gì cần qua barrel có kiểm soát.
- Tiêu cực: lệch phiên bản contract giữa bốn frontend là rủi ro thật; giảm nhẹ bằng workspace một phiên bản, compatibility window và cấm phát hành gói miền ra ngoài monorepo.

## ADR-008 — REST/JSON + OpenAPI 3.1 sinh từ zod, webhook cho OTA và PSP

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** UC-CHAN-02/03, UC-PAY-02, NFR-MAIN-04, [api.md](../api.md)

**Bối cảnh.** Cần hợp đồng API ổn định cho backend, bốn frontend và hai loại đối tác vào (webhook OTA, callback PSP). Đồ án phải vẽ được sequence diagram rõ ràng, mô phỏng được OTA mà không cần quyền truy cập đối tác thật, và "đóng băng hợp đồng API" ở mốc M3.

**Quyết định.** **REST/JSON** với tiền tố `/api/v1`, tài liệu **OpenAPI 3.1 sinh tự động từ schema `zod`** trong `packages/contracts` (một nguồn sự thật cho kiểm tra vào/ra và tài liệu). Mọi thao tác ghi mang header `Idempotency-Key`; webhook dùng `/api/v1/integrations/ota/{channel}/bookings` và `/api/v1/integrations/psp/{provider}/callback`; mã lỗi trả về đúng mã miền `E_<MOD>_<TÊN>`.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| REST/JSON + OpenAPI sinh từ zod | Một schema cho kiểm tra và tài liệu; dễ vẽ sequence, dễ chấm điểm; mô phỏng OTA đơn giản | Webhook phải tự định nghĩa và xác thực chữ ký | **Chọn** |
| GraphQL | Truy vấn linh hoạt cho màn hình báo cáo | Phức tạp phân quyền theo trường, khó mô phỏng đối tác, thừa nhu cầu | Loại |
| tRPC | An toàn kiểu đầu-cuối rất tốt | Ràng buộc hai đầu TypeScript, không phù hợp đối tác ngoài và mô phỏng OTA | Loại |
| gRPC | Hiệu năng, hợp đồng chặt | Nặng với giao diện web/mobile; không phải chuẩn của OTA/PSP | Loại |

**Hệ quả.**
- Tích cực: mọi DTO được kiểm tra bằng cùng schema ở API và ở client, giảm lệch hợp đồng (NFR-MAIN-04).
- Tích cực: webhook là điểm vào chuẩn hoá cho `ChannelAdapter`, giữ nguyên mẫu Adapter + Anti-Corruption Layer.
- Tiêu cực: không có kênh đẩy theo thời gian thực; thông báo cho nhân viên phải dựa vào thông báo đẩy/email và làm mới định kỳ.
- Tiêu cực: `v1` cần kỷ luật khi tiến hoá — thêm trường là tương thích, đổi ngữ nghĩa phải tạo phiên bản mới.

## ADR-009 — VNPay + MoMo (sandbox) kèm tiền mặt/chuyển khoản

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-PAY-01…10, BR-CANCEL-11/12/18, NFR-SEC-02, [kien-truc.md §2](../kien-truc.md)

**Bối cảnh.** Khách cần trả cọc trực tuyến (UC-PAY-02) và lễ tân cần thu tiền mặt/chuyển khoản tại quầy (UC-PAY-01, UC-PAY-03). Hệ thống **không được** lưu dữ liệu thẻ (BR-PAY-04); callback phải idempotent (BR-PAY-03); hoàn tiền về phương thức gốc và ghi bằng bút toán đảo (BR-PAY-08/09); phí xử lý hoàn mặc định 0 và cấu hình được (BR-CANCEL-11); yêu cầu ở `PENDING` có thể bị huỷ khi khách rút; việc rút không khôi phục booking (BR-CANCEL-18).

**Quyết định.** Hai cổng trực tuyến là **VNPay** và **MoMo** ở chế độ sandbox, đặt sau `PaymentGatewayAdapter` với hai hiện thực `VnpayAdapter`, `MomoAdapter`; thanh toán tại quầy ghi trực tiếp bằng `Payment` với `method` là `CASH` hoặc `BANK_TRANSFER`, kèm `createdBy` và `paidAt` để đối soát theo cặp (người thu, ngày VN) — hệ thống không quản lý ca làm việc (BR-PAY-06/10). Không tích hợp PSP quốc tế (ngoài phạm vi).

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| VNPay + MoMo sandbox + tiền mặt/chuyển khoản | Phù hợp thị trường Việt Nam; có sandbox để kiểm thử callback và hoàn tiền | Hai hợp đồng khác nhau cần hai adapter; hoàn tiền sandbox có thể phải làm tay | **Chọn** |
| Chỉ một cổng (VNPay) | Giảm công tích hợp | Không chứng minh được mẫu Adapter với nhiều hiện thực; rủi ro phụ thuộc một nhà cung cấp | Loại |
| Stripe/PayPal | Tài liệu tốt, sandbox mạnh | Ngoài phạm vi và không phù hợp thị trường mục tiêu | Loại |
| Chỉ tiền mặt/chuyển khoản | Không cần tích hợp | Không đáp ứng UC-PAY-02 và luồng cọc trực tuyến của khách | Loại |

**Hệ quả.**
- Tích cực: mẫu Adapter + ACL che toàn bộ khác biệt tham số, chữ ký và mã phản hồi giữa hai cổng; miền chỉ thấy `PaymentSucceeded`.
- Tích cực: giao dịch quá hạn BR-PAY-05 chuyển `FAILED(local_timeout)`; hold chỉ hết tại `holdExpiresAt` theo BR-BOOK-18. Thành công muộn vẫn ghi receipt và xử lý BR-PAY-11, không hồi sinh booking.
- Tiêu cực: hoàn tiền qua PSP sandbox không phải lúc nào cũng tự động; luồng dự phòng là ghi `Payment` loại `REFUND` và chuyển `PAID` khi kế toán xác nhận, vẫn giữ đúng BR-PAY-09.
- Tiêu cực: hai bộ tham số bí mật và hai luồng xác thực chữ ký phải kiểm thử riêng, tăng khối lượng kiểm thử tích hợp.

## ADR-010 — JWT (access 15 phút, refresh 7 ngày) + RBAC theo `propertyScope`

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-RBAC-01…06, NFR-SEC-01/03/05, [kien-truc.md §3.2](../kien-truc.md)

**Bối cảnh.** Bảy vai trò độc lập (BR-RBAC-01, gồm SYSADMIN) với phạm vi cơ sở: ngoài `OWNER` mọi vai trò chỉ thấy dữ liệu thuộc cơ sở của mình (BR-RBAC-02). Web quản trị hết phiên sau 15 phút không hoạt động; Android giữ phiên 7 ngày nhưng thao tác tài chính yêu cầu nhập lại PIN 6 số (BR-RBAC-05); khoá tài khoản 15 phút sau 5 lần đăng nhập sai (BR-RBAC-06).

**Quyết định.** **JWT**: access token 15 phút, refresh token 7 ngày có luân chuyển; payload mang `userId`, `role`, `propertyScope[]`; **RBAC** kiểm permission cụ thể × object × propertyScope ở guard và application cho 100% endpoint, kể cả replay; role không có thứ bậc, OWNER không tự kế thừa thu/chi của ACCOUNTANT, SYSADMIN chỉ có quyền kỹ thuật được cấp; kèm bộ lọc phạm vi cơ sở áp ở tầng truy vấn. Mật khẩu và PIN băm bằng **Argon2id**. Refresh token bị thu hồi khi đổi mật khẩu/đăng xuất, danh sách thu hồi lưu Redis.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| JWT ngắn hạn + refresh luân chuyển + RBAC | Không lưu phiên ở máy chủ; hợp cả web và Android; phạm vi cơ sở nằm ngay trong token | Thu hồi khó hơn phiên máy chủ; phải quản lý vòng đời refresh token | **Chọn** |
| Phiên máy chủ (cookie) + Redis | Thu hồi tức thời, kiểm soát tốt | Kém thuận tiện cho app di động; mọi request chạm Redis | Loại |
| OIDC với nhà cung cấp ngoài | Bớt mã xác thực | Thêm phụ thuộc ngoài, khó kiểm soát vai trò và phạm vi cơ sở đặc thù | Loại |
| Token dài hạn không refresh | Đơn giản nhất | Không đáp ứng BR-RBAC-05 và tăng rủi ro khi lộ token | Loại |

**Hệ quả.**
- Tích cực: cùng một cơ chế phục vụ web khách, back-office và Android; phạm vi cơ sở kiểm được ở tầng truy vấn nên không phụ thuộc việc giao diện có ẩn dữ liệu hay không (NFR-SEC-01).
- Tích cực: access token ngắn hạn giới hạn thiệt hại khi token bị lộ; refresh luân chuyển phát hiện dùng lại token cũ.
- Tiêu cực: thu hồi tức thời cần danh sách thu hồi ở Redis; đây là điểm phức tạp phải viết và kiểm thử rõ ràng.
- Tiêu cực: thao tác tài chính trên Android cần thêm bước nhập PIN — chấp nhận vì đánh đổi lấy kiểm soát gian lận tại quầy.

## ADR-011 — Vitest + fast-check, Testcontainers + Supertest, Playwright, Maestro, k6

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** BR-INV-03, NFR-REL-01, NFR-MAIN-01/03, [05/kế hoạch kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md)

**Bối cảnh.** Ràng buộc loại trừ chống trùng phòng chỉ chứng minh được với **PostgreSQL thật**; động cơ giá và chính sách huỷ cần kiểm thử thuộc tính trên miền hàm thuần; 100% BR phải có ít nhất một ca kiểm thử (NFR-MAIN-03); bộ unit + tích hợp phải chạy dưới 10 phút.

**Quyết định.** **Vitest** cho unit test toàn monorepo; **fast-check** cho kiểm thử thuộc tính miền; **Testcontainers + Supertest** cho kiểm thử tích hợp trên PostgreSQL/Redis thật; **Playwright** cho web; **Maestro** cho Android; **k6** cho kiểm thử tải 200 người dùng đồng thời. Testcontainers dựng CSDL từ `infra/sql/` nên ràng buộc loại trừ luôn có mặt khi chạy test.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Vitest + fast-check + Testcontainers + Playwright + Maestro | Kiểm được bất biến thật trên CSDL thật; miền kiểm bằng thuộc tính; phủ cả web và Android | Khởi động container tốn thời gian; Maestro cần thiết bị/trình giả lập | **Chọn** |
| Chỉ Jest, không kiểm thử thuộc tính | Quen thuộc, ít cấu hình | Khó chứng minh "hoàn không bao giờ vượt số đã trả" trên mọi đầu vào | Loại |
| Mock CSDL trong mọi test | Nhanh | Không kiểm được ràng buộc loại trừ — bất biến quan trọng nhất bị bỏ trống | Loại |
| Chỉ kiểm thử thủ công theo kịch bản demo | Không tốn công viết test | Trái NFR-MAIN-03; không bảo vệ khi sửa mã về sau | Loại |

**Hệ quả.**
- Tích cực: kịch bản 200 yêu cầu đồng thời chạy được trong CI với CSDL thật, chứng minh tiêu chí thành công #1 ([00 §12](../../00-tong-quan.md)).
- Tích cực: kiểm thử thuộc tính bắt được lỗi làm tròn và lỗi chọn bậc mốc tại biên (`167h59` so với `168h00`) mà test ví dụ dễ bỏ sót.
- Tiêu cực: thời gian khởi động container và trình giả lập làm tổng thời gian CI tăng; giảm nhẹ bằng cách chia bộ test unit (nhanh, mỗi lần đẩy) và bộ e2e (chạy hằng đêm).
- Tiêu cực: `fast-check` cần bộ sinh dữ liệu (bộ sinh khoảng ngày, bộ sinh hệ số) — chi phí ban đầu mà nhóm phải trả ở Sprint 2.

## ADR-012 — GitHub Actions → Docker (API/worker) + Vercel (web) + EAS Build (Android)

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** NFR-USE-01, NFR-REL-04, [00 §9/§10](../../00-tong-quan.md), [kien-truc.md §7](../kien-truc.md)

**Bối cảnh.** Ba sản phẩm có ba đường phát hành khác nhau: API và worker chạy container tự vận hành; web phù hợp nền tảng tĩnh/SSR; Android phát hành APK. Nhóm cần một nơi duy nhất quyết định "được gộp hay không" và giữ bí mật ngoài mã nguồn.

**Quyết định.** **GitHub Actions** làm CI/CD duy nhất với ba workflow: `ci.yml` (lint, typecheck, unit, tích hợp, build image), `e2e-nightly.yml` (Playwright, Maestro, k6), `eas-build.yml` (EAS Build). API và worker dùng **chung một image Docker, hai entrypoint**; web triển khai trên Vercel; Android phát hành APK qua EAS Build. Migration chạy trong bước phát hành trước khi tiến trình API khởi động. Bí mật nằm ở GitHub Actions secrets, Vercel Environment Variables và EAS Secrets.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| GitHub Actions + Docker + Vercel + EAS Build | Một nơi cấu hình cho backend và bốn frontend; repo đã ở GitHub; Vercel/EAS có gói miễn phí cho học tập | Hạn mức phút CI và hàng đợi EAS; phụ thuộc ba dịch vụ ngoài | **Chọn** |
| GitLab CI | Pipeline mạnh | Phải chuyển nơi lưu mã nguồn, không có lợi ích tương xứng | Loại |
| Jenkins tự dựng | Kiểm soát hoàn toàn | Tốn công vận hành, không phù hợp ngân sách môn học | Loại |
| Phát hành thủ công trên máy cá nhân | Nhanh lúc đầu | Không tái lập được, dễ lệch môi trường, khó chứng minh trong báo cáo | Loại |

**Hệ quả.**
- Tích cực: chất lượng được chặn ở cổng gộp mã — lint, typecheck, unit, tích hợp phải xanh trước khi vào nhánh chính.
- Tích cực: một image cho api và worker tránh lệch phiên bản giữa hai tiến trình dùng chung miền và repository.
- Tiêu cực: migration tự động trong CD có thể chạy hai lần khi phát hành song song — cần khoá migration và thứ tự phát hành tường minh (chạy migration trước, sau đó mới triển khai container).
- Tiêu cực: hạn mức phút CI và hàng đợi EAS Build có thể chặn ở tuần cao điểm; giảm nhẹ bằng bộ test theo phạm vi khi đẩy nhánh nhỏ và để bộ e2e chạy hằng đêm.

## ADR-013 — Sơ đồ Mermaid nằm trong Markdown, lưu cùng mã nguồn

**Trạng thái:** Đã chấp nhận · **Ngày:** 10/2026 · **Liên quan:** [docs/README §3](../../README.md), [00 §10](../../00-tong-quan.md)

**Bối cảnh.** Bộ tài liệu có nhiều sơ đồ: use case, miền, máy trạng thái, animation/activity, sequence, ERD, kiến trúc, triển khai. Sơ đồ phải **diff được**, review được trong pull request, không phụ thuộc công cụ bản quyền, và không lệch khỏi mã nguồn.

**Quyết định.** Mọi sơ đồ vẽ bằng **Mermaid trong chính tệp `.md`** đặt cạnh nội dung mô tả; tên định danh trong sơ đồ dùng đúng định danh của [00 §7](../../00-tong-quan.md). Sơ đồ kiến trúc nằm ở [kien-truc.md](../kien-truc.md), tệp này chỉ chứa bảng quyết định.

**Phương án đã cân nhắc.**

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|-----------|---------|-----------|----------|
| Mermaid trong Markdown | Diff theo dòng; hiển thị trên GitHub/VS Code; không cần công cụ ngoài | Bố cục tự động, khó căn chỉnh thủ công; cần kiểm tra cú pháp | **Chọn** |
| PlantUML (tệp `.puml` riêng) | Nhiều loại sơ đồ chuyên sâu | Cần máy chủ/công cụ render; khó xem trực tiếp trên GitHub | Loại |
| Ảnh PNG/SVG vẽ bằng draw.io | Bố cục đẹp, chủ động | Không diff được; sửa nhỏ cũng phải vẽ lại; dễ lệch tài liệu | Loại |
| Công cụ trực tuyến (Lucidchart, Figma) | Cộng tác tốt | Phụ thuộc tài khoản ngoài; không nằm trong repo | Loại |

**Hệ quả.**
- Tích cực: mọi sơ đồ thuộc cùng một cú pháp nên thành viên chỉ học một lần; thay đổi sơ đồ hiện ngay trong diff của pull request.
- Tích cực: sơ đồ và bảng quy tắc nằm cạnh nhau nên ràng buộc nghiệp vụ và hình vẽ khó lệch nhau.
- Tiêu cực: Mermaid bố cục tự động, với sơ đồ lớn có thể ra hình khó đọc — cần chia thành nhiều sơ đồ nhỏ, một chủ đề mỗi sơ đồ.
- Tiêu cực: không có kiểm tra cú pháp tự động nếu không viết; giảm nhẹ bằng bước kiểm tra cú pháp Mermaid trong `ci.yml` và quy ước "mỗi khối Mermaid phải được render thử trước khi đẩy".

---

## Tham chiếu

- [00 — Tổng quan dự án](../../00-tong-quan.md) — §9 bảng quyết định công nghệ, §10 cấu trúc repo đích
- [01 — Yêu cầu phi chức năng](../../01-yeu-cau/yeu-cau-phi-chuc-nang.md) — NFR-PERF, NFR-REL, NFR-SEC, NFR-USE, NFR-MAIN, NFR-COMP, NFR-OBS, NFR-LOC
- [02 — Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md) — 139 quy tắc BR
- [04 — Kiến trúc](../kien-truc.md) — kiến trúc tổng thể, lục giác, phân rã 13 module, dữ liệu, triển khai, quan sát
- [04 — Thiết kế lớp](../thiet-ke-lop.md) · [04 — Sequence Diagram](../sequence-diagram.md)
- [04 — Cơ sở dữ liệu](../csdl.md) · [04 — API](../api.md)
- [05 — Lộ trình](../../05-ke-hoach/lo-trinh.md) · [05 — Quy tắc kỹ thuật](../../05-ke-hoach/quy-tac-ky-thuat.md)
