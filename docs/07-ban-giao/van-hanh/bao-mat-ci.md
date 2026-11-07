# HB-183 — job CI bảo mật và hạn xử lý CVSS

**Đã hiện thực:** workflow `Security` (`.github/workflows/security.yml`) gồm CodeQL, Trivy filesystem/image,
`pnpm audit` và cổng CVSS ≥ 7,0 với hạn 7 ngày + file waiver. Gitleaks là workflow riêng của HB-176, nay
chạy thêm hằng đêm. **GitHub Actions đã bật lại (31/10/2026)**; ngày 01/11/2026 đã vá chuỗi dependency và
làm xanh cổng audit/Trivy. Pentest staging vẫn chưa thực hiện — không gọi các kết quả dưới đây là nghiệm
thu bảo mật đầy đủ.

## Job và điều kiện chặn

| Workflow / job | Chạy khi | Chặn khi |
| --- | --- | --- |
| `security.yml` / `audit` | PR (bỏ qua diff chỉ tài liệu), hằng đêm, tag `v*`, chạy tay | cổng CVSS/waiver không đạt (bước `pnpm audit --audit-level=high` chỉ để lộ kết quả registry) |
| `security.yml` / `codeql` | như trên | CodeQL `security-extended` báo lỗi, hoặc không tải được SARIF |
| `security.yml` / `trivy` | như trên; ảnh chỉ quét ngoài PR | HIGH/CRITICAL chưa có bản vá (`ignore-unfixed: false`) ở lockfile, Dockerfile hoặc ảnh |
| `security.yml` / `audit` bước cổng phát hành | tag `v*` hoặc dispatch `release=true` | còn finding CVSS ≥ 7,0 — bỏ qua toàn bộ waiver |
| `secret-scan.yml` / `gitleaks` | PR, push `main`, hằng đêm, chạy tay | phát hiện bí mật trong toàn lịch sử HEAD |

PR giữ thời gian phản hồi bằng cache pnpm của `setup-node`, cache CSDL Trivy qua `actions/cache`,
`paths-ignore` cho `docs/**`, `**/*.md`, `tests/maestro/**` và không build ảnh. Đánh đổi: PR chỉ sửa tài
liệu không sinh check này — đừng đặt làm required check nếu chưa chấp nhận.

## Chính sách CVSS ≥ 7,0, hạn 7 ngày và waiver

`security-audit-gate.mjs` đọc báo cáo `pnpm audit --json` (không đọc `node_modules`). Finding vào cổng
khi **CVSS ≥ 7,0** — kể cả registry xếp `moderate`, ví dụ `uuid` 7.5 — hoặc khi **chưa có điểm CVSS** mà
registry xếp `high`/`critical`; không suy điểm từ nhãn severity. Bước `pnpm audit --audit-level=high` chỉ tạo
báo cáo và luôn thoát 0; **chỉ cổng** quyết định đạt/không đạt — lấy trần `--audit-level=high` làm cổng thì
waiver vô nghĩa và mọi PR sẽ đỏ vĩnh viễn.

"Đã xử lý" chỉ đến từ waiver có chủ và ngày rà soát trong `.github/workflows/security-waivers.json`:

| Trường | Ý nghĩa |
| --- | --- |
| `github_advisory_id`, `package` | khoá khớp advisory với `module_name` của `pnpm audit`; trùng khoá bị từ chối |
| `owner` | người chịu trách nhiệm xử lý/rà soát, không để trống |
| `reason` | vì sao chấp nhận (không áp dụng được, chỉ công cụ phát triển, có kiểm soát bù…), không phải "tạm bỏ qua" |
| `firstSeen` | ngày phát hiện (`YYYY-MM-DD`); quá 7 ngày mà vẫn còn finding thì **chặn**, waiver không gia hạn |
| `reviewedAt` | ngày rà soát gần nhất, không trước `firstSeen`, và phải trong 7 ngày gần nhất |

Cổng fail closed khi báo cáo audit không có `advisories` — lỗi mạng/registry không được coi là đạt.
`--release` (tag phát hành) bỏ qua waiver: release không đi kèm lỗ hổng CVSS ≥ 7,0 đã biết. Gia hạn quá 7
ngày không phải việc của file waiver; phải vá/nâng, thay dependency hoặc sửa NFR-SEC-06 có duyệt.

**Trạng thái 07/11/2026:** hiện **không có waiver nào** (`security-waivers.json` rỗng, `.trivyignore` chỉ còn chú thích).
Hai waiver Expo cuối (`zod@3.25.76`, `decode-uri-component@0.2.2`, TD-70) đã được gỡ bằng sửa thật chứ không gia hạn:
override `@expo/cli` 57.0.33 (không còn kéo zod 3) và override `decode-uri-component` 0.5.1 kèm `pnpm patch`
`query-string@7.1.3` (`patches/query-string@7.1.3.patch`) để nhận export ESM. Ảnh `api`/`worker` chạy trên
`node:22-alpine`, bỏ npm/corepack/yarn khỏi lớp chạy; Trivy ảnh = 0 HIGH/CRITICAL (OS và Node). Khi nâng
Expo SDK nên bỏ patch nếu `expo-router` thôi dùng `query-string@7`.

## Chạy cục bộ

```sh
pnpm audit --json > /tmp/pnpm-audit.json || true
node .github/workflows/security-audit-gate.mjs /tmp/pnpm-audit.json \
  --waivers .github/workflows/security-waivers.json      # thêm --release để mô phỏng tag
python3 -c 'import yaml; [yaml.safe_load(open(f)) for f in __import__("glob").glob(".github/workflows/*.yml")]'
node --check .github/workflows/security-audit-gate.mjs
```

## Đứng sau reverse proxy — quyết định triển khai (01/11/2026)

Hạn mức theo IP (TD-60) chỉ đúng khi API biết IP khách. Chốt:

- API production **PHẢI** chạy sau **một luồng reverse proxy tin cậy** kết thúc TLS (nền tảng hosting do
  HB-174 chọn). Không mở cổng API trực tiếp ra Internet.
- `FastifyAdapter` đặt `trustProxy` theo **số hop tin cậy của nền tảng** (hoặc danh sách CIDR) đọc từ biến
  môi trường, ví dụ `TRUST_PROXY_HOPS`/`TRUST_PROXY_CIDRS`; mặc định `false` ở dev/test. **Cấm** đặt
  `trustProxy: true` (tin mọi `X-Forwarded-For`, cho phép giả IP và vượt hạn mức).
- HB-175 (IaC) sở hữu việc bật cấu hình và ghi bằng chứng staging: gửi `X-Forwarded-For` giả từ ngoài,
  xác nhận `request.ip` vẫn là IP kết nối thật; log/metric hạn mức dùng `request.ip` đó.
- Trước khi HB-175 xong, coi TD-60 là "đã hiện thực, chưa nghiệm thu production" — không tuyên bố hạn mức
  IP bảo vệ được API sau proxy.

## Bằng chứng cục bộ ngày 22/10/2026, nền `350f079` — chỉ cục bộ/tĩnh

- 5 tệp `.github/workflows/*.yml` parse được bằng PyYAML 6.0.3; `node --check` và `eslint` trên script cổng đều mã 0.
- `pnpm audit --json`: **4 high, 0 critical, 11 moderate, 3 low**, exit 1 (nên `--audit-level=high` cũng vậy).
- Cổng với waiver đã cam kết (`reviewedAt` 22/10): **exit 0** cho 5 finding trên; `--today 2026-10-30` hoặc
  `firstSeen` 10/10 → exit 1; `--release` với waiver hợp lệ → exit 1; báo cáo `{}` → exit 2.
- Waiver rỗng (tệp `/tmp`): **5 finding**, exit 1 — `uuid` 7.5, `node-forge` 7.5, `braces` 7.5,
  `markdown-it` 7.5, `vite` (high, chưa có điểm) — chứng minh cổng không bỏ sót finding.

## Chưa nghiệm thu

- **GitHub Actions đã bật lại (31/10/2026)**, code scanning/GHAS hoạt động; PR #216 đã làm xanh audit +
  Trivy. Repo không bật được branch protection (GitHub Free) nên vẫn dựa vào `pnpm pr:merge` làm hàng rào.
- **CodeQL và Trivy chưa chạy cục bộ**: máy này không có `codeql`/`trivy`, Trivy cần CSDL tải từ mạng;
  phần đã kiểm chỉ là YAML + tham số. Kết quả quét thật phải đến từ runner.
- **Còn 2 advisory waive có ngày** (`decode-uri-component`, `zod` 3 — TD-70) sau khi đã vá `node-forge`,
  `uuid`, `markdown-it`, `vite`, `dompurify`, `next`. Không dùng baseline SARIF để né cổng.
- **`.trivyignore` chỉ chứa `CVE-2026-118664`** (cùng `decode-uri-component`, Trivy không đọc
  `security-waivers.json` và không có waiver theo ngày). Mỗi mục có lý do + mốc rà lại trong tệp; khi nâng
  `query-string`/`expo-router` phải xoá mục này. Đây là ngoại lệ được lead duyệt ngày 01/11/2026, không
  thay cho việc vá dependency.
- **Pentest staging**: xem [checklist pentest](pentest-checklist.md) — mọi mục runtime đang BLOCKED.

## Quyết định tự đưa ra

1. Script cổng và file waiver đặt trong `.github/workflows/` vì allow của HB-183 chỉ gồm thư mục này và
   `docs/07-ban-giao/van-hanh/**`; `.github/**` đã có trong `unlock`.
2. Không nhân bản gitleaks: `secret-scan.yml` của HB-176 là nơi duy nhất quét bí mật; chỉ thêm lịch đêm.
3. CodeQL chỉ bật `javascript-typescript`: repo không có tệp `.kt`/`.java`, app Expo là JS/TS nên được phủ.
4. Ảnh quét đại diện `docker/api.Dockerfile`; `docker/worker.Dockerfile` dùng cùng base `node:22-alpine` và
   cùng lockfile, nên chênh lệch nằm ở lockfile đã được Trivy fs phủ. Đổi nền Debian → Alpine (07/11/2026) vì
   Debian 12 có 35 mục OS HIGH/CRITICAL chưa có bản vá (`affected`/`fix_deferred`/`will_not_fix`) và Debian 13 có 48;
   Alpine 0. Không dùng `ignore-unfixed` hay hạ
   `severity` để giữ cổng đỏ đúng nghĩa.
5. (Lead, 01/11/2026) Bật `limit-severities-for-sarif: true` cho cả hai bước Trivy. Mặc định của
   trivy-action v0.36.0 là `false`: action **bỏ `TRIVY_SEVERITY`** để SARIF có đủ mức, nên `exit-code: 1`
   đỏ vì cả MEDIUM/LOW — cổng không còn là "HIGH/CRITICAL". Bật `true` để SARIF và exit-code cùng lọc
   đúng `severity: HIGH,CRITICAL`; đây là sửa cấu hình, không nới cổng.
