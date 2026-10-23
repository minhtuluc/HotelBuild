# Phát hành Android — EAS build, EAS Update, APK dự phòng (HB-189)

**Trạng thái:** cấu hình và quy trình đã có, **chưa có lần build EAS/APK thật nào** (chưa có tài khoản EAS,
`EXPO_TOKEN`, khoá ký, thiết bị). Mọi mục "BLOCKED" bên dưới là việc phải làm trước khi đóng HB-189 và
TD-02 (cổng go-live 13). Không gọi cấu hình này là "build được" khi chưa có bằng chứng chạy thật.

Căn cứ: kiến trúc §7 (`eas-build.yml`), ADR-018 (hai app độc lập), RSK-24 (hết quota EAS), TD-02.

## 1. Hai app, hai pipeline

| App | Thư mục | `android.package` | Cấu hình |
| --- | --- | --- | --- |
| Customer | `apps/customer-android` | `vn.pinehill.customer` | `app.json`, `eas.json` |
| Operations | `apps/operations-android` | `vn.pinehill.operations` | `app.json`, `eas.json` |

Hai app có **dự án EAS riêng, khoá ký riêng, kênh cập nhật riêng**; không dùng chung `projectId`, keystore hay
token cập nhật. `versionCode` do EAS tự tăng (`appVersionSource: remote` + `autoIncrement` ở profile
`production`); `version` trong `app.json` là số hiển thị **và** là runtime version (§3).

| Profile (`eas.json`) | Dùng cho | Đầu ra | Kênh cập nhật | Biến môi trường EAS |
| --- | --- | --- | --- | --- |
| `preview` | thử nội bộ / smoke thiết bị (TD-02) | APK, phân phối nội bộ | `staging` | môi trường `preview` |
| `production` | bản phát hành | AAB (Play Store) | `production` | môi trường `production` |
| `apk-fallback` | hết quota EAS hoặc cần APK ký production | APK, kế thừa `production` | `production` | môi trường `production` |

Không có profile `development`: build dev-client cần thêm `expo-dev-client` (phụ thuộc mới, ngoài phạm vi
HB-189). Dev dùng `pnpm --filter <app> start` với Expo Go hoặc `expo run:android`.

## 2. Việc của chủ dự án trước lần build đầu (BLOCKED)

Repo cố ý **không chứa** các giá trị sau; không đoán và không commit chúng.

1. Tạo tài khoản/tổ chức EAS, rồi trong từng thư mục app chạy `eas init` — lệnh ghi `extra.eas.projectId` vào
   `app.json` (việc này là một commit riêng, mỗi app một ID).
2. Chạy `eas update:configure` trong từng app để sinh `updates.url` (và kiểm lại `runtimeVersion`). Không viết
   tay `updates.url`.
3. Cài `expo-updates` bằng `npx expo install expo-updates` ở cả hai app. Việc này sửa `package.json` và
   `pnpm-lock.yaml` nên **nằm ngoài `allow` của HB-189** — lead duyệt một ticket nhỏ. Chưa có `expo-updates`
   thì app không nhận được EAS Update dù đã có cấu hình.
4. Tạo secret GitHub `EXPO_TOKEN` (token robot của EAS, quyền tối thiểu).
5. Tạo biến môi trường EAS cho hai môi trường `preview` và `production`, **cho từng app**:
   `EXPO_PUBLIC_API_BASE_URL` (URL đầy đủ; chưa chốt vì hosting API thuộc HB-174). `EXPO_PUBLIC_APP_VARIANT` đã
   đặt sẵn trong `eas.json` (giá trị công khai, không bí mật). Ứng dụng dừng ngay lúc khởi động nếu thiếu
   biến (`src/config/index.ts`).
6. Khoá ký: để EAS quản lý keystore (`eas credentials`) hoặc nạp keystore có sẵn. **Sao lưu keystore ngoài
   repo** (mất khoá = không cập nhật được app đã phát hành). Không đưa keystore/mật khẩu vào repo, `.env` hay
   log CI; `.gitignore` đã chặn `.env*`, `*.pem`.
7. Tài khoản Google Play + khoá service-account khi bắt đầu `eas submit` (ngoài phạm vi HB-189).

## 3. Build bằng EAS

Workflow `.github/workflows/eas-build.yml`:

- **Chạy tay:** Actions → *EAS Build* → chọn `app` (`both` / `customer` / `operations`) và `profile`.
- **Tag `android-v*`:** build `production` cho cả hai app.
- Không có trigger `pull_request` nên PR từ fork không bao giờ đọc được secret; job còn bỏ qua repo fork.
- Mỗi app chạy `typecheck`, `test` và `pnpm build` (xuất bytecode Hermes) **trước** khi gửi lên EAS để không
  tốn quota cho bản hỏng, rồi `eas build --non-interactive --no-wait`. Kết quả build xem trên expo.dev.
- Thiếu `EXPO_TOKEN` thì job dừng với thông báo rõ ràng.
- Cổng phát hành: trước tag, chạy *Security* với `release=true` (`bao-mat-ci.md`) và xác nhận xanh; workflow
  này không tự gọi workflow khác.

Chạy cùng lệnh thủ công khi cần (đã đăng nhập EAS):

```bash
cd apps/operations-android   # hoặc apps/customer-android
npx eas-cli@16 build --platform android --profile preview
```

## 4. EAS Update — chỉ vá JS

Quy tắc: **chỉ phát hành cập nhật cho thay đổi JavaScript/kiểu dáng/tài nguyên mà bản cài đặt đã hỗ trợ.**

- `runtimeVersion: { "policy": "appVersion" }` ⇒ runtime version = `version` trong `app.json`. Bản vá JS giữ
  nguyên `version`; mọi thay đổi **native** (thêm/nâng thư viện native, đổi plugin, quyền, nâng Expo SDK, đổi
  `android.package`…) **bắt buộc** tăng `version` và build lại bằng EAS Build. Máy đang cài bản cũ sẽ không
  nhận cập nhật khác runtime — đó là cơ chế chặn, không "sửa" bằng cách ép.
- Hệ quả của chính sách này: quên tăng `version` khi đổi native là lỗi người dùng không bị chặn tự động.
  Đưa việc kiểm này vào checklist PR; nếu muốn máy kiểm thì cân nhắc đổi sang policy `fingerprint` (quyết định
  riêng vì ảnh hưởng tới máy nhận được cập nhật).
- Kênh: build `preview` → `staging`, `production`/`apk-fallback` → `production`. Thử trên `staging` trước.

```bash
cd apps/operations-android
npx eas-cli@16 update --channel staging --environment preview --message "<mô tả ngắn>"
# sau khi thử xong, đưa đúng bản đã thử lên production theo hướng dẫn deployment của EAS:
# https://docs.expo.dev/eas-update/deployment.md
```

- Bản release không tự áp ngay: thử bằng cách **tắt hẳn** app và mở lại, có thể cần tối đa **hai lần mở nguội**
  (lần 1 tải, lần 2 chạy bản mới).
- Chỉ phát hành lên `production` khi có người chịu trách nhiệm phê duyệt; ghi `message` truy vết được tới PR/ticket.
- Cập nhật không được thay đổi hợp đồng API đã phát hành: `extra.contractVersion` trong `app.json` phải khớp
  máy chủ (`check:contract`).

## 5. APK dự phòng khi hết quota EAS (RSK-24)

Hai đường, theo thứ tự ưu tiên. **Cả hai đều BLOCKED** tới khi có tài khoản/khoá ký và máy dựng có Android SDK.

**A. `eas build --local` (giữ khoá ký của EAS, không tốn quota dựng):**

```bash
cd apps/operations-android
npx eas-cli@16 build --platform android --profile apk-fallback --local
```

Điều kiện: đã `eas login`, Node 22 + pnpm (repo), JDK 17, Android SDK/NDK theo yêu cầu của
`eas build --local` cho Expo SDK 57, và `EXPO_PUBLIC_API_BASE_URL` xuất sẵn trong môi trường shell. Chưa kiểm cách
`--local` nạp biến môi trường EAS; xuất sẵn biến trong shell để chắc chắn.

**B. `expo prebuild` + Gradle (không cần EAS, dùng khi mất cả đăng nhập EAS):**

```bash
cd apps/operations-android
EXPO_PUBLIC_APP_VARIANT=production EXPO_PUBLIC_API_BASE_URL=<URL> npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease     # APK: android/app/build/outputs/apk/release/
```

Cảnh báo đã kiểm: `expo prebuild` sinh dự án có `applicationId` đúng (`vn.pinehill.operations`) nhưng cấu hình
`release` **mặc định ký bằng khoá debug**. APK đó chỉ dùng để thử; muốn phát hành phải thêm `signingConfig`
trỏ tới keystore production (đường dẫn và mật khẩu qua biến môi trường/`gradle.properties` cục bộ, không commit)
và dùng cùng keystore với bản đã phát hành, nếu không máy đang cài sẽ không nâng cấp được. `prebuild` cũng sửa
`package.json` (script `android`) và tạo thư mục `android/`: **không commit** các thay đổi này.

## 6. Smoke trên thiết bị thật (TD-02) — BLOCKED

Checklist ghi vào PR/biên bản khi có máy (APK `preview` của từng app):

1. Cài APK, mở app: không treo, không màn trắng, hiện màn đăng nhập; tắt mạng → thông báo cần kết nối.
2. Đăng nhập tài khoản thử, chọn cơ sở, mở các màn chính của app (customer: tìm phòng → đơn của tôi;
   operations: tra cứu, khách đến, buồng phòng); TalkBack đọc được nhãn nút chính.
3. Customer: đặt/huỷ thử trên API staging; operations: check-in một booking thử, kiểm thao tác tiền không
   xếp hàng khi mất mạng.
4. Cài chồng bản mới (cùng keystore) giữ được đăng nhập; gửi một EAS Update lên `staging` và xác nhận áp sau tối đa
   hai lần mở nguội.
5. Chụp ảnh/dump logcat không chứa token, mật khẩu hay PII; đính kèm vào bằng chứng cổng go-live 13.

Kịch bản Maestro có sẵn ở `tests/maestro/` (cần `maestro` và thiết bị/emulator; chưa chạy được ở môi trường
hiện tại).

## 7. Đã kiểm và chưa kiểm

| Hạng mục | Trạng thái |
| --- | --- |
| `app.json`/`eas.json` hợp lệ (`expo config --type public` cho cả hai app, `runtimeVersion` được nhận) | đã chạy cục bộ |
| Workflow đọc được bằng trình phân tích YAML; cú pháp biểu thức tự rà (không có `actionlint` trên máy) | đã rà tay |
| `typecheck`, `vitest`, `pnpm build` Hermes của hai app sau khi sửa `app.json` | xem PR |
| `expo prebuild` sinh dự án Android với đúng `applicationId` | đã chạy cục bộ (đã dọn) |
| Lần chạy hosted của `eas-build.yml` | **BLOCKED** (GitHub Actions đang tắt ở cấp repo, chưa có `EXPO_TOKEN`) |
| `eas build` / APK / ký số | **BLOCKED** (tài khoản EAS, keystore, Android SDK) |
| EAS Update end-to-end | **BLOCKED** (cần `expo-updates`, `projectId`, `updates.url`, bản build cài trên máy) |
| Smoke thiết bị / Maestro / TalkBack (TD-02) | **BLOCKED** (không có thiết bị) |
