# Checklist go-live — Pine Hill

**Lập:** 22/10/2026 · **Nhánh nền:** `origin/main` @ `350f079` · **Ticket:** [HB-190](../../08-thi-cong/tickets/HB-190-checklist-go-live.md) · **Chủ:** lead

Nguồn: [lộ trình §4 — 14 cổng go-live](../../08-thi-cong/lo-trinh-den-deploy.md#4-cổng-go-live), [§5 — quyết định còn mở](../../08-thi-cong/lo-trinh-den-deploy.md#5-quyết-định-còn-mở), cổng 4 của [ADR-018](../../04-thiet-ke/adr/ADR-018-backend-chung-bon-frontend.md), [bàn giao §5](../../07-ban-giao/huong-dan-thi-cong.md#5-cổng-nghiệm-thu-và-giới-hạn-bằng-chứng).

Lộ trình §4 đặt luật: *"Không mục nào được đánh dấu đạt bằng tài liệu; mỗi mục cần log hoặc biên bản trên đúng commit sẽ deploy."* Vì vậy trang này chỉ ghi **bằng chứng đã tồn tại**, và mọi chỗ chưa có đều ghi rõ artifact còn thiếu — không suy diễn từ việc "đã có mã".

## 0. Cách đọc trạng thái

| Trạng thái | Nghĩa | Điều kiện đổi |
| --- | --- | --- |
| `ĐÃ CÓ` | Có artifact trong repo/CI ở `main` chứng minh đúng phát biểu của cổng | Vẫn phải chạy lại trên commit deploy và lưu log — việc của cổng 1 |
| `CHƯA CÓ` | Chưa có artifact; tạo được bằng việc trong repo | Ticket ở cột cuối |
| `BLOCKED` | Không tạo được bằng chứng cho tới khi có điều kiện ngoài repo (staging, credential, thiết bị, chữ ký) | Điều kiện ghi ở cột "Thiếu gì" |

`CẦN ĐIỀN` = con người phải điền; không được tự bịa tên, giờ hay số liệu.

## 1. Mười bốn cổng go-live

| # | Cổng (nguyên văn lộ trình §4) | Bằng chứng đang có | Trạng thái | Thiếu gì để đóng | Chủ — ticket |
| --- | --- | --- | --- | --- | --- |
| 1 | CI xanh mọi job, nightly xanh 3 đêm liền | Workflow: [`ci.yml`](../../../.github/workflows/ci.yml), [`e2e-nightly.yml`](../../../.github/workflows/e2e-nightly.yml), [`secret-scan.yml`](../../../.github/workflows/secret-scan.yml). Lần xanh gần nhất: CI `f935dce` 08/10 ([run 37860027285](https://github.com/minhtuluc/HotelBuild/actions/runs/37860027285)); nightly xanh 01–05/10 | `CHƯA CÓ` | `main` @ `350f079` **không có run hosted nào**; các run 09–10/10 đỏ hoặc kẹt `queued` ([37895863656](https://github.com/minhtuluc/HotelBuild/actions/runs/37895863656)); nightly đỏ 06–08/10 rồi **không chạy** từ 09/10 ([37855196781](https://github.com/minhtuluc/HotelBuild/actions/runs/37855196781)); `secret-scan.yml` chưa từng chạy (0 run) | Codex — [HB-188](../../08-thi-cong/tickets/HB-188-e2e-nightly-day-du.md) |
| 2 | Chống trùng phòng qua API: 200 song song → đúng 1 | [`holds.spec.ts` AC4](../../../apps/api/test/holds/holds.spec.ts): 200 lệnh HTTP song song, pool 50 → **1×201, 199×409**, đúng 1 booking, 1 assignment, không mồ côi; [`assignments.spec.ts`](../../../apps/api/test/concurrency/assignments.spec.ts): 200 tx/50 backend → 1 commit, 199 xung đột. PR #81, #137 | `ĐÃ CÓ` | Không. Giới hạn phải nhớ: dưới pool 50 một phần lệnh nhận 500 **trước** use case (TD-17) nên harness phải thử lại bằng khoá mới — phải đo lại ở cổng 6 | Codex — HB-008, HB-076 (đã merge) |
| 3 | Giá khớp 5 nguồn (API + 4 frontend), sai 0 VND | Không có `tests/e2e/price-parity/**` hay `docs/07-ban-giao/bang-chung-gia.md` trong repo | `CHƯA CÓ` | Báo cáo đối chiếu ≥ 10 kỳ mẫu (mùa, cuối tuần, kênh, khuyến mãi) trên 5 nguồn | DeepSeek — [HB-187](../../08-thi-cong/tickets/HB-187-doi-chieu-gia-5-nguon.md) |
| 4 | Bảng quyết định huỷ/hoàn 100%, chặn tự duyệt | [`decision-table.ts`](../../../packages/domain/test/cancellation/fixtures/decision-table.ts) đủ 34 hàng `DT-01…34`, chạy `test.each` trong [`engine.spec.ts`](../../../packages/domain/test/cancellation/engine.spec.ts) (biên 168h00/167h59); [`refunds.spec.ts`](../../../apps/api/test/duyet-hoan-tien/refunds.spec.ts) "cấm tự duyệt ở mọi mức"; trigger `fn_guard_refund_approval` trong [csdl](../../04-thiet-ke/csdl.md). PR #30, #147 | `ĐÃ CÓ` | Log chạy trên commit deploy (cổng 1). Ghi chú: 34/34 hàng chạy trong `pnpm run ci` cục bộ trên `350f079` | Codex — HB-053, HB-099 (đã merge) |
| 5 | Callback PSP trùng/muộn không tạo tiền thứ hai | [`webhook-psp.spec.ts`](../../../apps/api/test/webhook-psp/webhook-psp.spec.ts): TN-3 — 5 callback trùng → 1 Payment/1 inbox; TN-4 — callback muộn không hạ trạng thái; TN-6 — lỗi CSDL không ACK thành công. PR #145 | `BLOCKED` | **Chưa có credential sandbox VNPay/MoMo** (quyết định §5 mục 2 chưa chốt) ⇒ không thể có log sandbox | Codex — [HB-095](../../08-thi-cong/tickets/HB-095-webhook-psp.md) + lead chốt credential |
| 6 | Tải 200 VU đạt NFR-PERF | Không có script k6 nào trong repo (`tests/load/**` chưa tồn tại) | `BLOCKED` | Chưa có staging để đo ([HB-175](../../08-thi-cong/tickets/HB-175-ha-tang-iac.md) chưa làm); chưa có kịch bản 60/30/10 + spike 600 VU | Codex — [HB-184](../../08-thi-cong/tickets/HB-184-tai-k6.md) |
| 7 | Backup + restore thật: RPO ≤ 15 phút, RTO ≤ 4 giờ | [migration.md §5](migration.md#5-thất-bại-và-hồi-phục) chỉ nêu mục tiêu là "cần đo"; chưa có biên bản diễn tập | `BLOCKED` | Chưa có staging, backup off-site, snapshot/PITR và biên bản restore đo RPO/RTO | Codex — [HB-179](../../08-thi-cong/tickets/HB-179-sao-luu-phuc-hoi.md) |
| 8 | Rollback diễn tập trên staging | Chưa có runbook rollback production trong `van-hanh/`; [migration.md §5](migration.md#5-thất-bại-và-hồi-phục) mới chỉ là nhánh SQL | `BLOCKED` | Runbook + biên bản diễn tập trên staging ([HB-180](../../08-thi-cong/tickets/HB-180-runbook-rollback.md)) | Codex — HB-180 |
| 9 | Bảo mật: 0 CVSS ≥ 7 quá hạn, 0 bí mật, 0 dữ liệu thẻ trong log | [quet-bi-mat.md](quet-bi-mat.md) (gitleaks cục bộ + 11 báo giả đã phân loại); [va-dependency-20261014.md](va-dependency-20261014.md); test không lộ PAN ([`webhook-psp.spec.ts`](../../../apps/api/test/webhook-psp/webhook-psp.spec.ts)); che PII ([observability-error-logs.md](observability-error-logs.md)) | `CHƯA CÓ` | `pnpm audit` 22/10: 0 critical, **4 high**, 11 moderate, 3 low (bản 14/10 ghi 2 high — advisory mới); không có CodeQL/Trivy; job `secret-scan` chưa từng chạy hosted; chưa pentest | Codex — [HB-183](../../08-thi-cong/tickets/HB-183-bao-mat.md) |
| 10 | Quan sát: log có trace id, cảnh báo bắn đúng | Trace W3C + `correlationId` (PR #160) ở [api/tracing](../../../apps/api/src/infrastructure/tracing/tracing.ts) và [worker/tracing](../../../apps/worker/src/tracing/tracing.ts); cấu hình OTel/SLO/burn-rate ở [infra/observability](../../../infra/observability/README.md) | `BLOCKED` | Chính README đó ghi BLOCKED: chưa có collector/Prometheus/Grafana, chưa có ảnh dashboard hay log cảnh báo thử; 3/6 SLO thiếu nguồn số; HB-182 chưa có mã (`modules/sys/alerts` không tồn tại) | Codex — [HB-181](../../08-thi-cong/tickets/HB-181-quan-sat.md) AC3, [HB-182](../../08-thi-cong/tickets/HB-182-canh-bao-van-hanh.md) |
| 11 | Accessibility: axe 0 serious/critical trên 83 màn | [`axe-f8.spec.ts`](../../../tests/e2e/f8/axe-f8.spec.ts) quét **7** bề mặt F8 (Chromium) | `CHƯA CÓ` | Báo cáo 83 màn × 6 cấu hình trình duyệt, TalkBack, zoom 200 %, 360 px | Gemini — [HB-185](../../08-thi-cong/tickets/HB-185-ra-soat-truy-cap.md) |
| 12 | UAT 3 kịch bản × 4 frontend có chữ ký, 0 P0/P1 | E2E web chạy trên **API giả** ([playwright.config.ts](../../../tests/e2e/playwright.config.ts)); chưa có biên bản UAT | `CHƯA CÓ` | Biên bản 3 kịch bản × 4 frontend × từng actor, có chữ ký, 0 P0/P1 | Gemini — [HB-191](../../08-thi-cong/tickets/HB-191-uat.md) |
| 13 | Android: 2 app build được, smoke trên thiết bị thật | `expo export --platform android` + kiểm Hermes trong [`customer-android/package.json`](../../../apps/customer-android/package.json) và [`operations-android/package.json`](../../../apps/operations-android/package.json); application ID `vn.pinehill.customer`, `vn.pinehill.operations` | `BLOCKED` | Không có `eas.json`/credential EAS ⇒ chưa có APK/AAB; không có thiết bị hay emulator (TD-02) ⇒ chưa có ảnh/dump smoke | DeepSeek — [HB-189](../../08-thi-cong/tickets/HB-189-phat-hanh-android.md) |
| 14 | Quyết định §5 đã chốt bằng văn bản | [`docs/05-ke-hoach/nhat-ky/`](../../05-ke-hoach/nhat-ky/) chỉ có QĐ-01…05 (F0, backend, F1, quản trị, engine) — không mục nào chạm 10 quyết định §5 | `CHƯA CÓ` | 10 văn bản QĐ-nn: hosting, credential PSP, pháp lý dữ liệu, bộ quan sát, OPEN-02, OPEN-03, Q-01…16, đăng nhập lại trước thanh toán/huỷ, MERGE_CONNECTING + Airbnb, nhịp quét quá tải | Lead + chủ đầu tư — [HB-174](../../08-thi-cong/tickets/HB-174-qd-hosting.md) |

**Tổng hợp:** 2 `ĐÃ CÓ` (cổng 2, 4) · 6 `CHƯA CÓ` (1, 3, 9, 11, 12, 14) · 6 `BLOCKED` (5, 6, 7, 8, 10, 13). Không cổng nào có log hosted trên commit deploy, vì commit deploy chưa được chọn và CI hosted đang kẹt từ 10/10.

## 2. Release checklist từng app

Dùng đúng lệnh trong `package.json` của từng app; `pnpm -r build` (CI gọi qua `products:build`) chạy lần lượt cả 6 app.

| App | Lệnh build | Artifact / khởi chạy | Contract version | Cửa sổ tương thích | Người phát hành |
| --- | --- | --- | --- | --- | --- |
| `@pinehill/api` | `pnpm --filter @pinehill/api build` → `tsc -p tsconfig.build.json` | `dist/main.js`, chạy `node --conditions=pinehill-dist dist/main.js` | `1.0.0` (`CONTRACT_VERSION`) | `CHƯA CÓ` — HB-177 chưa có release gate | Codex (kỹ thuật) · người bấm: `CẦN ĐIỀN` |
| `@pinehill/worker` | `pnpm --filter @pinehill/worker build` → `tsc -p tsconfig.build.json` | `dist/main.js`, cùng lệnh chạy | `1.0.0` (hợp đồng job/outbox trong `packages/contracts`) | `CHƯA CÓ` — như trên | Codex · `CẦN ĐIỀN` |
| `@pinehill/customer-web` | `pnpm --filter @pinehill/customer-web build` → `next build` | `.next/`, chạy `next start --port 3001` | `1.0.0` | `CHƯA CÓ` | DeepSeek · `CẦN ĐIỀN` |
| `@pinehill/operations-web` | `pnpm --filter @pinehill/operations-web build` → `next build` | `.next/`, chạy `next start --port 3002` | `1.0.0` | `CHƯA CÓ` | DeepSeek · `CẦN ĐIỀN` |
| `@pinehill/customer-android` | `pnpm --filter @pinehill/customer-android build` → `expo export --platform android` + `check-android-hermes.mjs` | `dist/` bundle JS. **APK/AAB chưa có** — chưa cấu hình EAS | `1.0.0` | `CHƯA CÓ` | DeepSeek · `CẦN ĐIỀN` |
| `@pinehill/operations-android` | `pnpm --filter @pinehill/operations-android build` (như trên) | `dist/` bundle JS. **APK/AAB chưa có** | `1.0.0` | `CHƯA CÓ` | DeepSeek · `CẦN ĐIỀN` |

Ghi chú bắt buộc đọc kèm:

- **Nguồn contract version:** [`CONTRACT_VERSION = '1.0.0'`](../../../packages/contracts/src/openapi/generate.ts) trong bộ sinh OpenAPI; mọi app/package trong workspace cùng `1.0.0`. Hai cổng `check:openapi` và `check:contract` chỉ bắt drift/phá vỡ **so với bản nền**, không so bản build của app với API đang chạy.
- **Chưa có release gate phiên bản** ([HB-177](../../08-thi-cong/tickets/HB-177-pipeline-deploy.md)): ADR-018 cổng 4 yêu cầu chặn phát hành khi contract version/cửa sổ không đạt; hiện chưa có cơ chế nào. [migration.md §4](migration.md#4-contract--chỉ-thu-hẹp-sau-khi-hết-client-cũ) cấm tự đặt số ngày cửa sổ ⇒ ô "cửa sổ tương thích" phải để trống cho tới khi HB-177 chốt.
- **EAS Update chưa cấu hình:** `app.json` không có `runtimeVersion`/`updates` ⇒ mọi bản vá JS phải phát hành cả app; HB-189 quyết định runtime/OTA.
- **Quy tắc tạm thời:** vì chưa có release gate, chỉ được deploy bộ 6 app build từ **cùng một SHA**, và mọi app cũ chưa cập nhật phải coi là chưa tương thích cho tới khi HB-177 có cơ chế.

## 3. Kế hoạch ngày go-live

### 3.1 Điều kiện vào cửa sổ

Chỉ bắt đầu khi **cả 14 cổng ở §1 là `ĐÃ CÓ`** trên đúng commit sẽ deploy, và có đủ: SHA + image digest của bản hiện tại và bản mới, snapshot/PITR trước deploy, người trực đủ 3 ca, biên bản rollback đã diễn tập. Thiếu bất kỳ mục nào thì hoãn — không "chạy tạm rồi bù biên bản".

### 3.2 Mốc thời gian (giờ VN, `CẦN ĐIỀN` xác nhận)

| Mốc | Việc | Người |
| --- | --- | --- |
| T-5 | Đóng băng tính năng; chốt danh sách migration và app nào phát hành | Lead · `CẦN ĐIỀN` |
| T-3 | Chạy đủ 14 cổng trên release candidate, dán log vào PR phát hành | Codex · Gemini |
| T-1 17:00 (**cut-off**) | Khoá mã nguồn: không merge gì thêm; chốt SHA + digest, snapshot trước deploy | Lead |
| T-1 20:00 | Migration expand trên production; chạy [kiểm sau migration](migration-post-checks.md) | Codex |
| T 20:00–22:00 | Deploy `api` + `worker` → 2 web app; theo dõi 60 phút mỗi bước | `CẦN ĐIỀN` |
| T 22:00 | Phát hành Android theo bậc (nếu HB-189 xong) | `CẦN ĐIỀN` |
| T+1 | Rà SLO 24 giờ, quyết định "nhận go-live" hoặc rollback | Lead |

### 3.3 Trực và liên lạc (`CẦN ĐIỀN` toàn bộ)

| Ca | Giờ VN | Người trực | Dự phòng | Kênh |
| --- | --- | --- | --- | --- |
| Phát hành | 19:00–24:00 | `CẦN ĐIỀN` | `CẦN ĐIỀN` | `CẦN ĐIỀN` (điện thoại + nhóm chat) |
| Đêm | 00:00–08:00 | `CẦN ĐIỀN` | `CẦN ĐIỀN` | `CẦN ĐIỀN` |
| Ngày D+1 | 08:00–18:00 | `CẦN ĐIỀN` | `CẦN ĐIỀN` | `CẦN ĐIỀN` |

Leo thang: người trực → lead (Opus) → chủ đầu tư. Không liên lạc được người trực chính quá 15 phút thì gọi dự phòng rồi lead.

### 3.4 Tiêu chí dừng (dừng ngay, không chờ thêm)

1. Bất kỳ cổng nào ở §1 chuyển đỏ trong cửa sổ.
2. Burn-rate chạm ngưỡng cảnh báo (14,4×/1 giờ hoặc 6×/6 giờ) hoặc 5xx > 1 % trong 10 phút.
3. p95 API > 400 ms kéo dài 15 phút, hoặc hàng đợi `waiting` > 100 job / lỗi > 10 job mỗi 15 phút.
4. Outbox lag > 5 phút hoặc job tiền (chi hoàn, no-show, quét quá tải) chậm > 15 phút.
5. Bất kỳ dấu hiệu tiền/tồn sai: hai payment cho một booking, hai hold cùng phòng, số dư lệch sổ cái.
6. Migration báo failed hoặc [kiểm sau migration](migration-post-checks.md) không đạt.
7. Mất liên lạc người trực chính quá 15 phút.
8. Lead hoặc chủ đầu tư yêu cầu dừng.

### 3.5 Đường rollback

Thứ tự và giới hạn:

1. **App:** quay về image/digest cũ đã ghi, kiểm health rồi chạy lại [kiểm sau migration](migration-post-checks.md). Đường này **phụ thuộc pipeline HB-177** — hiện `CHƯA CÓ`; deploy tay không được coi là rollback.
2. **CSDL:** **không** chạy down migration. Làm theo [migration.md §5](migration.md#5-thất-bại-và-hồi-phục): giữ lưu lượng ở bản tương thích, PITR/restore theo HB-179, cần MANAGER+ phê duyệt, ngoài giờ cao điểm, ghi audit.
3. **Runbook đang có:** [migration](migration.md), [kiểm sau migration](migration-post-checks.md), [log lỗi API](observability-error-logs.md), [quét bí mật](quet-bi-mat.md), [biến môi trường và lịch xoay khoá](bien-moi-truong.md) (bảng AC1–AC2 của HB-176, chưa nghiệm thu), [bản vá dependency](va-dependency-20261014.md). **Chưa có runbook rollback production** ([HB-180](../../08-thi-cong/tickets/HB-180-runbook-rollback.md)) — đây là điều kiện chặn go-live, không phải việc làm sau.
4. **Sau rollback:** biên bản sự cố (SHA/digest trước–sau, thời điểm, chỉ số đã vượt ngưỡng, người quyết định), chạy lại cổng kiểm, thông báo cho chủ đầu tư và khách bị ảnh hưởng nếu có.

### 3.6 Truyền thông

Kênh nội bộ và đầu mối của chủ đầu tư: `CẦN ĐIỀN`. Ba mẫu tin bắt buộc: "bắt đầu cửa sổ", "hoàn tất/rollback", "sự cố + mức ảnh hưởng".

## 4. Nhật ký cập nhật

| Ngày | Thay đổi | Người |
| --- | --- | --- |
| 22/10/2026 | Lập checklist trên `350f079`: 14 cổng, release checklist 6 app, kế hoạch ngày go-live | Gemini (HB-190) |
