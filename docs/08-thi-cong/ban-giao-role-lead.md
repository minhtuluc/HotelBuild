# Bàn giao vai lead — 15/11/2026

Tài liệu này là **ảnh chụp trạng thái lúc bàn giao**, dành cho người nhận vai lead. Nó không thay thế [sổ tay lead](so-tay-lead.md) (quy trình và bài học dài hạn) mà bổ sung phần **còn dở dang** và phần **bài học mới phát sinh trong các đợt merge vừa rồi**.

Đọc theo thứ tự: [AGENTS.md](../../AGENTS.md) → [quy trình](README.md) → [sổ tay lead](so-tay-lead.md) → tài liệu này → [sổ nợ kỹ thuật](../07-ban-giao/no-ky-thuat.md).

## 1. Trạng thái lúc bàn giao

| Mục | Giá trị |
|---|---|
| `main` | `14b125f` — fix(HB-321): chín ca E2E operations-web đỏ trên main xanh lại (#317) |
| CI trên `main` | xanh (Quality gate + Backend integration) |
| Secret scan / Documentation quality | xanh |
| Security (CodeQL, Audit, Trivy) | xanh tại `6fcb6b4` (hai lượt: tự động + dispatch tay) — sau mỗi đợt merge có mã thì dispatch tay lại: `gh workflow run security.yml --ref main` |
| E2E nightly (web) | hay bị `cancelled` (giới hạn runner) — không coi là tín hiệu đỏ |
| Sổ nợ kỹ thuật | 80 dòng TD, **43 còn Mở**, 3 BLOCKED (TD-75/76/78) |
| Hàng đợi PR | 10 PR mở, xếp chồng theo 4 nhánh (mục 2) |
| Nhánh `main` | **không** push trực tiếp; chỉ merge qua `pnpm pr:merge` |

Trạng thái nghiệm thu hiện tại đã ghi ở [bang-chung-a11y.md](../07-ban-giao/bang-chung-a11y.md) (46 PASS, 10 màn F6 covered, **27 BLOCKED** — thiếu thiết bị Android + WebKit) và [bang-chung-i18n.md](../07-ban-giao/bang-chung-i18n.md) (**0 node** chuỗi UI ngoài catalog; NFR-LOC vẫn chưa nghiệm thu vì QA hình ảnh Android BLOCKED).

## 2. Hàng đợi PR đang mở — thứ tự merge

Bốn nhánh độc lập. **Luôn merge nhánh cha trước, rồi rebase nhánh con** (mục 3.1).

| PR | Ticket | Base | Trạng thái | Còn phải làm trước khi merge |
|---|---|---|---|---|
| **#309** | HB-314 (TD-44 phần 2) | `main` | xanh | merge được ngay |
| **#316** | HB-316 (góp ý UI/UX gói B) | `main` | xanh | merge được ngay |
| **#314** | HB-319 (slug cơ sở) | `main` | xanh | merge được ngay; **migration `0013_property_slug`** |
| **#300** | HB-243 (API frontend đợt 1) | `main` | **CONFLICTING** | rebase lên `main` → CI lại → merge |
| **#315** | HB-320 (TD-44 phần 3) | #309 | Quality gate đỏ | merge #309 → rebase #315 → CI lại |
| **#308** | HB-312 (tiếng Anh `/en`) | #316 | Quality gate đỏ + **CodeQL đỏ** | merge #316 → rebase #308 → **sửa alert XSS** → CI lại |
| **#311** | HB-313 (zh/ja/ko/ru) | #308 | Quality gate đỏ | merge #308 → rebase #311 → CI lại |
| **#312** | HB-318 (ăn uống ở ga) | #311 | Quality gate đỏ | merge #311 → rebase #312 → CI lại |
| **#301** | HB-244 (ảnh công khai) | #300 | Quality gate đỏ | merge #300 → rebase #301 → **đánh số lại migration** → CI lại |
| **#310** | HB-315 (E2E SCR-48) | `main` | xanh | **trùng #303 đã merge** (cùng SHA `07106ad9`) → đóng, không merge |

Lưu ý thứ tự migration: **#301** và **#314** cùng đặt số `0013` (`0013_public_photos` vs `0013_property_slug`). Ai merge trước giữ `0013`, người sau **phải đánh số lại** thành `0014` (tên thư mục migration cũng phải đổi theo).

### 2.1. PR có thể xuất hiện sau khi bàn giao

Hàng đợi trên đây là ảnh chụp lúc 15/11/2026, **không phải danh sách đóng**. Trong lúc viết tài liệu này đã có thêm **#317** (HB-321 — chín ca E2E operations-web đỏ trên `main` do fixture E2E lệch hợp đồng sau HB-220; CI xanh, độc lập, đã merge). Luôn chạy `gh pr list --state open` trước khi lên kế hoạch.

### 2.2. Alert CodeQL đang chặn #308

`js/xss` (high) tại `apps/customer-web/src/components/language-select.tsx:17` — alert số 64, phát sinh trong phần code PR này. Phải **sửa code**, không dismiss: `check:imports` cũng cấm đọc `process.env` ngoài `apps/*/src/config`, nên giá trị phải đi qua đường cấu hình của app.

## 3. Những lỗi CI đã gặp và cách xử lý

### 3.1. PR con bị GitHub tự đóng khi merge PR cha

Repo bật auto-delete nhánh head sau khi merge. Khi nhánh base của một PR bị xoá, GitHub **tự đóng PR con**. Cách xử lý đã dùng nhiều lần:

1. **Trước** khi merge PR cha: `gh pr edit <số-PR-con> --base main` (nếu PR con chưa bị đóng).
2. Nếu PR con **đã bị đóng**: tạo worktree từ nhánh con, rebase `--onto origin/main <sha-cũ-của-nhánh-cha>`, đẩy lại nhánh, mở PR mới với cùng nội dung và ghi rõ "Thay thế #<cũ>" trong thân PR.
3. Không merge PR con khi Quality gate đỏ vì lý do này (mục 3.2) — đỏ là do diff còn mang file của PR cha.

### 3.2. Quality gate đỏ với `file được bảo vệ` ở PR xếp chồng

`check:scope` so diff của nhánh với `origin/main` và `docs/08-thi-cong/**` là file bảo vệ. PR con xếp trên PR cha nên diff của nó **mang theo file đặc tả của cha** (ví dụ #301 đỏ vì `tickets/HB-243-…md` của #300) → bị chặn.

Cách xử lý: **merge PR cha trước**, rồi rebase PR con lên `main` mới — lúc đó file của cha đã nằm trong `main` nên không còn trong diff của con, và cổng scope tự xanh. Không sửa file bảo vệ để lách.

### 3.3. `check:scope` và file đặc tả của chính PR

Đặc tả do người làm tự soạn trên nhánh mình là ngoại lệ hợp lệ (ticket mới chưa có trên `main`). Ngược lại, **đặc tả đã có trên `main` không được sửa**, kể cả đặc tả của chính ticket đó — nếu thật sự cần thì báo lead.

### 3.4. Sổ nợ kỹ thuật hay đụng nhau

`docs/07-ban-giao/no-ky-thuat.md` được nhiều PR sửa cùng lúc → conflict khi rebase. Quy tắc khi giải quyết: **giữ dòng mới nhất của `main` cho các TD không liên quan**, và lấy dòng của PR đang rebase cho TD mà PR đó đóng/mở. Ví dụ khi rebase #291 (đóng TD-12) lên `main` đã có #289 (đóng TD-13): giữ TD-12 của PR, TD-13 của `main`.

### 3.5. Job bị `cancelled` trên `main`

Đã xảy ra vài lần (Quality gate bị cancel, Backend integration vẫn xanh) — không phải lỗi code. Kiểm tra rồi chạy lại đúng job:

```sh
gh run list --branch main --limit 6 --json databaseId,workflowName,status,conclusion,headSha
gh run rerun <databaseId> --failed
```

### 3.6. `gh` chết giữa chừng (TLS handshake timeout / EOF)

`gh` hay rớt mạng khi đang merge. Nếu lệnh merge báo lỗi mạng, **kiểm tra trạng thái PR trước khi thử lại** — merge có thể đã thành công:

```sh
gh pr view <số-PR> --json state,mergedAt,mergeCommit
```

### 3.7. Số path OpenAPI phải cập nhật cùng PR

`packages/contracts/test/openapi.spec.ts` khoá đúng số path (hiện 122). Thêm endpoint ⇒ cập nhật số và danh sách path trong cùng PR, nếu không Quality gate đỏ.

### 3.8. Migration: `db:drift` và số thứ tự

Migration mới phải khớp `docs/04-thiet-ke/csdl.md` §3 (đây là oracle của test catalog) và `pnpm db:drift` phải không lệch. Hai PR mở cùng lúc đặt trùng số migration thì xem mục 2.

### 3.9. Đổi hợp đồng ⇒ E2E fake-api phải sửa theo, không chỉ fixture unit

#317: HB-220 đổi `meta.scan` và hình dạng ứng viên chi tiết ca; fixture **unit** được sửa nhưng fixture **E2E** (`tests/e2e/fake-api/**`) thì không, nên **chín ca E2E operations-web đỏ trên `main` vốn CI xanh**. Khi một PR đổi hợp đồng đã phát hành, phải rà cả `tests/e2e/fake-api/` và các spec E2E dùng nó — nếu không, `main` xanh CI nhưng E2E đỏ.

## 4. Luật chơi của vai lead (giữ nguyên khi nhận vai)

1. **Chỉ merge qua `pnpm pr:merge <số-PR>`** (`scripts/merge-pr.mjs`). Không dùng `gh pr merge` trực tiếp: script từ chối PR nháp, PR xung đột, check chưa xanh, và **thiếu một trong ba check bắt buộc** (`Quality gate (typecheck, lint, test, build)`, `docs-and-embedded`, `postgres16`).
2. **Không bao giờ merge khi CI đỏ.** Quy tắc đỏ oan chỉ dành cho nhóm lỗi đã biết TD-50/TD-61/TD-62 (timeout cụ thể), được rerun **một lần**; đỏ lần hai hoặc đỏ ở tệp khác là lỗi thật. Xem [sổ tay lead §4](so-tay-lead.md#4-xét-cuối-và-merge).
3. **Lead ghim `locked_sha`**, agent không tự ghim. Agent gửi SHA + log đỏ, lead review rồi ghim vào ticket trên `main` (nhánh `lead/*`), sau đó báo agent rebase. Một tệp khoá có thể nằm trong nhiều ticket ⇒ **ghim cùng hash ở mọi ticket đó** (xem #259: HB-126 và HB-127 cùng ghim fixture).
4. **Lead không viết test khoá giai đoạn A** của R2. Lead review A rồi ghim.
5. **DDL phải do lead duyệt** (bảng/cột/index/CHECK/FK, `ON DELETE`, khoá). Đã duyệt gần đây: `0011_room_move_case_consent` (#280), `0012_revoke_post_baseline` (#291).
6. **Sửa file bảo vệ ⇒ nhánh `lead/*` + PR riêng**, không sửa trong PR của agent (xem #292 — dòng §5 của lộ trình trong `lo-trinh-den-deploy.md`).
7. **Mọi nợ kỹ thuật phải có dòng TD** trong `no-ky-thuat.md`, kèm bằng chứng khi đóng; PR nào đóng nợ thì sửa dòng đó trong chính PR đó.
8. **QĐ-04**: PR R2 do chính lead làm thì người dùng duyệt sau khi lead tự chạy đủ §4 của AGENTS.md — không tự duyệt việc của mình.
9. Không push `main`, không push remote `nen-ooad`.

## 5. Việc đang chờ người dùng / đối tác

| Việc | Chặn cái gì | Người quyết |
|---|---|---|
| Tên miền + nhà cung cấp VPS | [QĐ-08](../05-ke-hoach/nhat-ky/QD-08-hosting.md) đã chốt hình thái (một VPS, Docker Compose, hai web trên VPS, Caddy TLS). Còn thiếu miền và nhà cung cấp ⇒ chưa có lượt Let's Encrypt thật, chưa có UAT trên stack thật | Chủ dự án |
| Credential PSP sandbox VNPay/MoMo | Thanh toán online chỉ chạy adapter mô phỏng; production **từ chối khởi động** nếu thiếu khoá (cố ý, xem #287) | Chủ dự án |
| Kho S3 off-site + khoá mã hoá | Backup/PITR (#297) đã có mã, chưa có kho thật ⇒ chưa có diễn tập restore thật | Chủ dự án |
| Thiết bị Android + WebKit + Maestro | 27 màn a11y BLOCKED; QA hình ảnh i18n BLOCKED; Maestro nightly không chạy | Người dùng |
| Credential EAS | Chưa có APK bản phát hành (HB-189) | Chủ dự án |

## 6. Việc nên làm trong 1–2 ngày đầu

1. Đọc [sổ tay lead](so-tay-lead.md) và tài liệu này; xem `gh pr list --state open` (danh sách ở mục 2 có thể đã cũ).
2. Xử lý hàng đợi theo mục 2: **#309 → #316 → #314 → #300** trước (bốn PR đều base `main`), rồi rebase từng nhánh con theo thứ tự cha–con.
3. Đóng **#310** (trùng #303).
4. Sửa alert XSS của **#308** (`apps/customer-web/src/components/language-select.tsx:17`) — sửa code, không dismiss.
5. Sau mỗi lần merge: kiểm CI trên `main`; nếu job bị cancel thì rerun (mục 3.5). Nếu CI đỏ do lỗi thật thì sửa ngay, không để `main` đỏ.
6. **Chạy E2E hai web** (`pnpm test:e2e`) sau mỗi đợt merge lớn — CI không bắt được ca E2E hỏng (mục 3.9); #317 là ví dụ: CI xanh mà chín ca E2E đỏ trên `main`.
7. Cập nhật sổ nợ: mỗi TD mà PR đóng cần dòng đúng trạng thái; đếm lại (mục 1) để người nhận vai sau có số liệu.
8. Dispatch `Security` tay sau khi merge có mã: `gh workflow run security.yml --ref main` (workflow không tự chạy trên push vào `main`).
9. Sửa [bang-chung-a11y.md](../07-ban-giao/bang-chung-a11y.md) và [bang-chung-i18n.md](../07-ban-giao/bang-chung-i18n.md) nếu có màn mới (F6/F7 đã có màn).

## 7. Lệnh thường dùng

```sh
git fetch origin --prune
gh pr list --state open
gh pr checks <số-PR>                    # tất cả job
gh pr view <số-PR> --json state,baseRefName,headRefName,mergeable
node scripts/check-scope.mjs            # cổng phạm vi (so với origin/main)
pnpm pr:merge <số-PR>                  # merge an toàn + chờ CI trên main
gh run list --branch main --limit 6 --json databaseId,workflowName,status,conclusion,headSha
pnpm db:drift                           # schema.prisma khớp chuỗi migration
```

| Cổng | Lệnh |
|---|---|
| Toàn bộ cổng của PR | `pnpm run ci` |
| Integration thật | `pnpm test:integration` (cần PostgreSQL 16 + Redis 7) |
| E2E hai web | `pnpm test:e2e` |
| Tài liệu | `npm run check:docs` (link, Mermaid, mã định danh) |

## 8. Ngoài phạm vi lead (để phân biệt khi có agent hỏi)

- Viết mã khối lượng lớn, test khoá R2, hay suy luận luật nghiệp vụ mới — agent làm, lead xét.
- Bằng chứng chạy thật (E2E, Maestro, bundle Android, lượt k6 trên staging) — agent chạy và ghi vào `docs/07-ban-giao/bang-chung-*.md`.
- Dữ liệu thật, credential, môi trường bên ngoài — chủ dự án cấp.
