# Bằng chứng thi công F0 — nền tảng 4 frontend

**Ngày chạy:** 27/09/2026 · **Môi trường:** Linux 7.2.5 (Fedora 44), Node `v22.23.1`, pnpm `10.34.5` · **Revision:** xem §6 (commit F0 và SHA ghi ở đó).
**Bối cảnh:** bản này thay bản trước sau [rà soát F0 của QC](review-f0.md); trạng thái từng phát hiện ở [phản hồi rà soát](review-f0-response.md).

Phạm vi: pha **F0** của [lộ trình thi công 4 frontend](../05-ke-hoach/lo-trinh-thi-cong-web-android.md) — workspace, hợp đồng API sinh tự động, client dùng chung, gói giao diện, 4 khung ứng dụng, biên lỗi/thiếu quyền và CI. Không gồm màn hình nghiệp vụ (F1 trở đi) hay backend.

## 1. Kết quả đã chạy

| Phép kiểm | Lệnh | Kết quả | Giới hạn của bằng chứng |
|---|---|---|---|
| Cài đặt tất định | `pnpm install --frozen-lockfile` | **PASS** | Cục bộ; chưa có log CI từ xa |
| Hợp đồng khớp bản commit | `pnpm check:openapi` | **PASS** — OpenAPI 3.1.0, 9 path, trùng byte | Chỉ 8 endpoint AUTH + `system/health` của F0 |
| **Thay đổi phá vỡ hợp đồng** | `pnpm check:contract` | **PASS** — 0 thay đổi phá vỡ so với bản nền 1.0.0 | Bản nền khởi tạo bằng chính hợp đồng F0; chưa có bản phát hành ngoài |
| Ranh giới frontend | `pnpm check:imports` | **PASS** — 11 gốc quét, 0 vi phạm | Quét tĩnh, không thay kiểm runtime |
| Kiểu | `pnpm typecheck` | **PASS** — 8/8 gói và app | `packages/config` không có mã TS |
| Kiểu harness E2E | `pnpm typecheck:e2e` | **PASS** | — |
| Lint (type-aware) | `pnpm lint` | **PASS** — 0 lỗi, 0 cảnh báo | Loại `docs/`, `scripts/`, `tests/` (QĐ-01 mục 13) |
| Định dạng | `pnpm format:check` | **PASS** | Artefact sinh tự động nằm ngoài Prettier |
| Test + **ngưỡng coverage** | `pnpm products:test:coverage` | **PASS** — **144 ca**: contracts 28, api-client 40, ui-web 46, ui-native 10, app web 3+3, app Android 7+7. `api-client` **94,44% functions / 95,75% statements** (trước sửa: 71,42% functions) | `ui-native` chưa render component bằng trình render RN (xem §2) |
| Dựng web | `pnpm products:build` | **PASS** — 2 app, 5 tuyến tĩnh mỗi app | Không chứng minh hiệu năng/tải |
| E2E + axe (Chromium) | `pnpm test:e2e` | **PASS — 36 ca** trên 2 web app: trang chủ + 10 trạng thái, `/api/ready`, 360 px, tuyến thiếu quyền, và 3 ca shell gọi API qua client (200/500/403) | Chỉ Chromium; WebKit chưa chạy |
| Bundle Android (Metro + Hermes) | `expo export --platform android` × 2 app | **PASS** — mỗi app 1 bundle Hermes | Bundle **không** thay smoke thiết bị (xem §2) |
| Kiểm tài liệu | `pnpm run check` | **PASS** — 916 liên kết, 80 sơ đồ, 139 BR/135 FR/53 UC/40 NFR/217 TC; **9** test công cụ (gồm ca đỏ của cổng hợp đồng) + 30 test DDL (1 SKIP nhúng) | Không phải nghiệm thu sản phẩm |
| Cổng tổng hợp | `pnpm run ci` | **PASS** — exit 0, đã gồm `check:contract` và `products:test:coverage` | Gồm: hợp đồng, phá vỡ, ranh giới, kiểu, lint, định dạng, test+coverage, build |

## 2. Chưa chạy (NOT_RUN) và bị chặn (BLOCKED)

| Hạng mục | Trạng thái | Lý do / điều kiện gỡ |
|---|---|---|
| Smoke Android trên emulator/thiết bị (F0-04) | **BLOCKED** | Đã dựng đủ công cụ: SDK `emulator` 37.1.11 + system image API 35 + `adb` + KVM dùng được (`emulator -accel-check` → "KVM (version 12) is installed and usable"), hai AVD (`f0` profile mặc định, `f0p` pixel_6). Ba lần khởi động đều đỏ ở tiến trình emulator **trước khi guest boot**: `-gpu swiftshader_indirect` (2 lần, exit 139/SIGSEGV), `-gpu off` (không lên thiết bị, log rỗng). `adb devices` trống; crash dump tại `/tmp/android-minhtu/emu-crash-37.1.11.db`. Đây là **giới hạn môi trường**, không thay bằng bundle Hermes; cần máy chạy được emulator hoặc thiết bị thật để gỡ |
| Maestro trên 2 app Android | **BLOCKED** | Chưa có luồng nghiệp vụ để chạy (F1–F7); chỉ có ý nghĩa khi F1 có màn hình |
| APK qua EAS + 2 application ID | **BLOCKED** | Cần `EXPO_TOKEN`, liên kết project và `eas.json`; theo lộ trình là việc của F9 |
| Tải 200 người dùng đồng thời (k6) và cạnh tranh CSDL qua ứng dụng | **NOT_RUN** | Cần API nghiệp vụ; cổng của F9 |
| WebKit/Safari (NFR-USE-04) | **NOT_RUN** | `e2e-nightly.yml` đã khai `chromium webkit`; chưa có log chạy WebKit |
| Render component `ui-native` bằng trình render RN trong CI | **NOT_RUN** | Chưa dựng runner RN (jest-expo) trong F0; parity câu chữ/định dạng đã kiểm ở mức hàm thuần |
| CI từ xa trên commit F0 | **NOT_RUN** | Cần đẩy nhánh lên GitHub; hiện chỉ có log cục bộ trên đúng revision |
| Màn hình nghiệp vụ và UAT | **NOT_RUN** | Thuộc F1–F9 |

## 3. Lỗi phát hiện trong F0 và cách xử lý

| # | Lỗi | Cách phát hiện | Xử lý |
|---|---|---|---|
| 1 | `servers: /api/v1` lặp với path đã có tiền tố → URL hiệu dụng `/api/v1/api/v1/...`; `pin/verify` và `logout` thiếu khai `security` | Rà soát QC (F0-01) | Một nơi chứa tiền tố; khai security; 2 ca kiểm tự động |
| 2 | Schema phản hồi `strictObject` từ chối trường lạ, ngược quy tắc tương thích tiến | Rà soát QC (F0-02) | Phản hồi dùng `z.object`; yêu cầu vẫn nghiêm; 5 ca kiểm |
| 3 | Coverage `api-client` 71,42% functions; CI không có cổng coverage; thiếu cổng so sánh phá vỡ hợp đồng | Rà soát QC (F0-03) | Bổ sung test (94,44%); đưa coverage vào CI; thêm `check:contract` + ca đỏ trong test công cụ |
| 4 | Shell thiếu biên lỗi và tuyến thiếu quyền; bundle bị coi là smoke | Rà soát QC (F0-04) | Panel dùng chung cho cả hai nền tảng, biên lỗi + `/access-denied` cho 4 shell, 5 ca E2E |
| 5 | `defaultId()` dùng `Math.random`, không đảm bảo UUIDv4 | Rà soát QC (F0-06) | Nguồn an toàn hoặc ném lỗi rõ ràng; Android truyền `createId` từ expo-crypto; 4 ca kiểm |
| 6 | Timeout được xoá sau khi nhận headers, body treo vượt hạn | Rà soát QC (F0-07) | Đọc body trong cùng phạm vi timeout, dọn timer + listener; 3 ca kiểm |
| 7 | App chưa dùng `api-client`; native hiện ISO thô thay vì giờ VN | Rà soát QC (F0-08) | Probe hợp đồng ở cả 4 shell; `formatDateTimeVn` cho native + ca parity |
| 8 | Bộ so hợp đồng bỏ qua enum lồng trong `properties` và coi phản hồi không có schema JSON là "bỏ phản hồi" | Test công cụ do nhóm viết | So schema đệ quy; bỏ qua phản hồi chỉ có mô tả |
| 9 | Tín hiệu huỷ đã-abort trước khi gọi không được tôn trọng | Test đơn vị api-client | Kiểm `signal.aborted` trước khi gắn listener |
| 10 | `Intl.DateTimeFormat('vi-VN')` xếp giờ trước ngày, lệch `dd/MM/yyyy HH:mm` | Test định dạng | Dựng chuỗi từ `formatToParts` theo thứ tự tài liệu (web và native) |
| 11 | `makeTranslate` nằm trong module `'use client'` → server component gọi bị chặn | `next build` | Tách `messages.ts` thuần khỏi `i18n.tsx` |
| 12 | Webpack của Next và Metro của Expo không ánh xạ specifier `.js` sang nguồn TS | `next build`, `expo export` | `resolve.extensionAlias` cho Next; shim resolver cho Metro |
| 13 | Hai bản React (web 19.3, native 19.2.3) → hook lỗi trong test | `pnpm products:test` | Thống nhất React 19.2.3; RN 0.86.3 theo Expo SDK 57 |
| 14 | Prettier định dạng lại artefact hợp đồng → cổng drift báo lệch giả | `pnpm run ci` | `.prettierignore` cho `openapi.json` và `openapi.baseline.json` |
| 15 | Fixture kiểm thử vi phạm hợp đồng (`pinToken` < 16 ký tự); bộ chọn E2E dính link "bỏ qua tới nội dung" | Chạy test | Sửa fixture/khai báo đúng hợp đồng, không nới lỏng schema |

## 4. Sản phẩm F0 (để QC đối chiếu)

- Workspace: `pnpm-workspace.yaml`, `.npmrc`, `.prettierignore`, `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml`.
- `packages/config` — tsconfig dùng chung (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), preset ESLint (luật ranh giới frontend), Prettier.
- `packages/contracts` — enum canonical theo 00 §7.8, danh mục 54 mã `E_*` (api.md §4.2), bao hình/phân trang/tác vụ 202, DTO AUTH, schema biến môi trường, **OpenAPI 3.1 sinh tự động** + **bản nền hợp đồng**.
- `packages/api-client` — client REST: `X-Correlation-Id`, `Idempotency-Key` (UUIDv4 từ nguồn an toàn), `If-Match`, chèn `pinToken`, gửi lại có giới hạn (502/503/504, `E_SYS_REQUEST_IN_PROGRESS` + `Retry-After`), timeout bao trọn phần đọc body, ánh xạ `E_*` sang `ApiError`; bề mặt `auth`.
- `packages/ui-web` — token §7, bộ định dạng vi-VN, ánh xạ mã lỗi → hành động UI + câu chữ, **hợp đồng 9 trạng thái** (10 fixture), danh mục i18n, `ErrorPanel`/`AccessDeniedPanel`, sinh biến CSS từ token.
- `packages/ui-native` — token Android (sp, 48 dp), câu chữ khớp web, định dạng giờ VN, 5 trạng thái hàng đợi ngoại tuyến, `NativeStateSurface`, `NativeErrorPanel`, `NativeAccessDeniedPanel`.
- `apps/customer-web`, `apps/operations-web` — Next.js 15 App Router, nhóm tuyến `(guest)`/`(ops)`, trang chủ + `?state=`, `/api/ready`, `error.tsx`/`global-error.tsx`, `/access-denied`, `ApiProbe` gọi API thật.
- `apps/customer-android`, `apps/operations-android` — Expo + Expo Router, biên lỗi router, `access-denied`, `+not-found`, `createAppApiClient()` (expo-crypto), `probeHealth()`.
- Cổng và CI: `scripts/check-openapi-drift.mjs`, `scripts/check-openapi-breaking.mjs` + `scripts/lib/openapi-diff.mjs`, `scripts/set-openapi-baseline.mjs`, `scripts/check-frontend-imports.mjs`, `tests/e2e/*`, `.github/workflows/{ci,e2e-nightly,docs-quality}.yml`.
- Quyết định: [QĐ-01](../05-ke-hoach/nhat-ky/QD-01-nen-tang-f0.md) · Phản hồi rà soát: [review-f0-response.md](review-f0-response.md).

## 5. Kết luận tự đánh giá

F0 ở trạng thái **sẵn sàng để QC nghiệm thu lại** với các mục §2 còn `NOT_RUN`/`BLOCKED`. Trong phạm vi F0, **một mục chưa có bằng chứng**: smoke Android trên emulator/thiết bị — môi trường này không khởi động được emulator (ba lần SIGSEGV trước khi guest boot), nên mục đó giữ `BLOCKED` và bundle Hermes không được tính thay. Mọi phát hiện F0-01…F0-03, F0-06…F0-08 đã sửa kèm test hồi quy; F0-05 đã chốt bằng commit ghi ở §6. Không có mục nào được đánh dấu đạt nhờ tiến độ viết tài liệu.

## 6. Revision và cách tái lập

- Revision nộp: **`REVISION_SHA`** (commit F0). Bản bằng chứng này nằm trong commit kế tiếp chỉ sửa `docs/`; mã nguồn và cổng không đổi giữa hai commit.
- Tái lập đầy đủ: `pnpm install --frozen-lockfile && pnpm run ci && pnpm run check && pnpm test:e2e`.
- Điều kiện sang F1: QC chấp thuận các mục F0-01…F0-08, hoặc nêu phát hiện mới; `Q-01…Q-16` cần chốt trước các pha phụ thuộc.
