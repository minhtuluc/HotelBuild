# Sổ tay lead — dành cho người thay vai lead

**Lập:** 02/10/2026 bởi lead Opus, để dự án đi tiếp khi lead hiện tại không còn. Đọc theo thứ tự: [AGENTS.md](../../AGENTS.md) → [quy trình](README.md) → [lộ trình đến deploy](lo-trinh-den-deploy.md) → trang này.

## 1. Ai thay vai lead

Từ [QĐ-04](../05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md): mọi agent báo cáo **chỉ** cho lead; lead xét cuối và merge.

| Tình huống | Lead thay thế | Ràng buộc bù |
|---|---|---|
| Opus không còn | **Codex (GPT-6.1 Sol)** | PR R2 do chính Codex làm: người dùng đồng ý merge sau khi Codex tự chạy lại đủ mục §4 (không ai tự duyệt việc của mình) |
| Codex quá tải hoặc hết quota | Người dùng merge R0/R1 khi CI xanh và báo cáo tự kiểm đủ | R2 chờ Codex, không hạ hạng |
| Cả Opus và Codex không có | Chỉ làm R0/R1 | Không merge R2 |

Lead không viết mã khối lượng lớn. Việc của lead: giao việc, gỡ vướng leo thang, xét cuối, merge, giữ backlog/quyết định khớp thực tế.

## 2. Vòng làm việc mỗi ngày

1. `git fetch origin --prune`; `gh pr list --state open`; xem `docs/08-thi-cong/backlog*.md` để biết ticket nào đã đủ điều kiện.
2. Gỡ chặn trước, review sau, viết đặc tả mới cuối cùng. PR đang chờ lead là thứ đắt nhất trong dây chuyền.
3. Giao việc theo [lộ trình §3](lo-trinh-den-deploy.md#3-đường-găng-và-việc-chạy-song-song): luôn giữ Codex làm lõi R2 trên đường găng, DeepSeek làm song song phía hợp đồng/màn hình.

## 3. Biến dòng backlog thành đặc tả

Từ QĐ-04, Codex/DeepSeek (và Gemini cho R0) **tự soạn** đặc tả trong nhánh của mình; lead chỉ viết trước cho việc khó hoặc dễ chồng phạm vi. Khi xét PR có đặc tả tự soạn, lead đọc đặc tả trước rồi mới đọc mã. Các bước dưới áp dụng cho cả người tự soạn.

1. Sao chép [mẫu](tickets/_mau.md) thành `tickets/HB-nnn-<slug>.md`.
2. Đọc **đúng** nguồn ghi ở cột "Căn cứ"; chép tiêu chí kiểm chứng được, mỗi tiêu chí gắn một test.
3. `allow`: glob hẹp nhất có thể. Kiểm không chồng với ticket khác đang mở hoặc sẽ chạy song song. Chỗ dùng chung (bảng quyền, API giả, router) thì thiết kế dạng ghép theo module (xem HB-014, HB-019).
4. `unlock` chỉ cho file được bảo vệ mà ticket thật sự phải sửa; liệt kê đủ ngay từ đầu (bài học HB-001, HB-005).
5. `max_lines` theo bảng §5.
6. R2: ghi rõ giai đoạn A (Codex viết test khoá trên nhánh `lead/HB-nnn-test-khoa`, merge trước, test đỏ) và giai đoạn B (DeepSeek).
7. Chạy: `npm run check:docs` (mã định danh phải có thật) và parse thử ticket:
   ```sh
   node --input-type=module -e "import {parseTicket} from './scripts/lib/scope.mjs'; import {readFileSync} from 'node:fs'; console.log(parseTicket(readFileSync('docs/08-thi-cong/tickets/HB-nnn-x.md','utf8')))"
   ```
8. Merge đặc tả vào `main` qua nhánh `lead/*` **trước** khi giao. Gemini được viết nháp đặc tả R0/R1; lead duyệt rồi mới merge.

## 4. Xét cuối và merge

Độ sâu theo hạng ([quy trình §2](README.md#2-hạng-rủi-ro--ai-làm-lead-xét-sâu-đến-đâu)). **Không bao giờ merge khi CI của PR chưa xanh** (bài học HB-005).

**Chỉ merge bằng `pnpm pr:merge <số-PR>`**, không dùng `gh pr merge` trực tiếp. Repo private trên GitHub Free không bật được branch protection/rulesets (thử 02/10/2026: HTTP 403 "Upgrade to GitHub Pro"), nên lệnh này là hàng rào: từ chối PR nháp, xung đột, thiếu hoặc chưa xanh một trong ba check bắt buộc; merge xong chờ CI trên `main` và báo nếu đỏ. Khi nâng lên GitHub Pro thì bật branch protection với cùng ba check.

1. `gh pr checks <n>` xanh mọi job. Báo cáo tự kiểm trong PR đủ mục; thiếu mục nào thì trả lại ngay, không tự chạy hộ.
2. `check:scope` có cảnh báo thì đọc phần giải trình "Ngoài phạm vi đã sửa"; không hợp lý thì yêu cầu tách.
3. R0: liếc diff → merge. R1: đọc file chính → merge.
4. R2: chạy lại trong worktree riêng phần rủi ro:
   ```sh
   git worktree add ../wt/review-HB-nnn origin/ticket/HB-nnn-<slug>
   cd ../wt/review-HB-nnn && pnpm install --frozen-lockfile && pnpm run ci
   ```
   rồi chạy thật (migrate trên CSDL tạm, `curl` endpoint, `docker run` image, test đồng thời) và đọc toàn bộ diff tìm: bí mật, PII trong log, thời gian/ngẫu nhiên trong miền, quyền thiếu, test bị nới.
5. Lỗi nhỏ thì lead sửa thẳng một commit trên nhánh rồi merge; lỗi đáng kể thì `NEEDS_CHANGES` **một lần**, gom đủ mọi điểm, ghi file:dòng và cách tái hiện.
6. Nhánh đứng sau `main` mà xung đột thì rebase rồi `--force-with-lease` (hoặc nhờ người làm). Merge squash, xoá nhánh, kiểm CI trên `main` sau merge.

## 5. Ước `max_lines`

Đếm không tính `pnpm-lock.yaml`, `openapi.json`, `schema.prisma` (xem `SIZE_EXEMPT` trong `scripts/lib/scope.mjs`).

| Loại ticket | Mức đặt |
|---|---|
| Sửa tài liệu | 120–200 |
| Tính năng nhỏ trong app/gói đã có | 400 |
| Endpoint + test khoá + audit | 450–700 |
| Hợp đồng nhiều endpoint + client + UI | 800 |
| Dựng khung app/gói mới | 700–750 |
| Migration sinh từ tài liệu | theo SQL thực tế, ghi lý do |

Từ QĐ-04 vượt `max_lines` chỉ là cảnh báo: người làm giải trình trong PR, lead chấp nhận nếu diff hợp lý (không mã chết, không test trùng), yêu cầu tách nếu ôm việc ngoài phạm vi.

## 6. Bài học đã trả giá

| Sự cố | Nguyên nhân | Cách phòng |
|---|---|---|
| Agent thi công tự mở nhánh `lead/*` để nới `unlock` (PR #4) | `check:scope` bỏ qua nhánh `lead/*`; chung một tài khoản GitHub | AGENTS.md cấm; lead kiểm tác giả mọi PR `lead/*` |
| `main` đỏ sau HB-005 | Merge khi CI PR đỏ; CI thiếu `prisma generate` | `pnpm pr:merge` từ chối khi check chưa xanh; `postinstall` sinh Prisma Client |
| HB-004, HB-006, HB-011 vượt `max_lines` | Lead ước thấp | Bảng §5 |
| HB-001, HB-005 thiếu file trong phạm vi | Đặc tả viết trước khi file liên quan tồn tại / grep bỏ sót | Grep lại toàn repo khi viết; cập nhật ticket khi phụ thuộc merge |
| `pnpm start` chết ngoài Docker sau HB-027 | Export điều kiện `pinehill-dist` chỉ bật trong image | Mọi lệnh chạy `dist` phải có `--conditions=pinehill-dist`; review phải chạy `pnpm start` thật |
| API container không nhận kết nối | `listen` cứng `127.0.0.1` | Biến `HOST`; review phải chạy image |
| Nightly xanh nhưng không có ca WebKit | Config Playwright thiếu project | Đếm số ca theo trình duyệt trong log, không chỉ nhìn "xanh" |
| Đường dẫn có dấu cách làm hỏng test | `URL.pathname` thay vì `fileURLToPath` | Luôn `fileURLToPath` |

## 7. Tài liệu phải giữ khớp

- `docs/08-thi-cong/backlog*.md`: trạng thái ticket (đổi khi merge).
- `docs/05-ke-hoach/nhat-ky/QD-nn-*.md`: mỗi quyết định mới một dòng, kèm lý do và phương án bị loại.
- `docs/04-thiet-ke/csdl.md` §3 cùng PR với migration (QĐ-02 mục 3).
- `docs/04-thiet-ke/api.md` §2.1/§4.2 cùng PR với hợp đồng.
- `docs/07-ban-giao/bang-chung-*.md` khi nghiệm thu pha.

## 8. Việc nên làm sớm nếu chưa làm

1. Branch protection cho `main`: người dùng đã đồng ý (02/10/2026) nhưng GitHub Free chặn với repo private — tạm dùng `pnpm pr:merge`; bật thật khi nâng GitHub Pro hoặc chuyển repo public.
2. Giao Codex ba engine HB-032, HB-052, HB-053 ngay khi rảnh: không phụ thuộc F1, nằm trên đường găng.
3. Chốt quyết định hosting (lộ trình §5 mục 1) trước W12, vì HB-175…HB-180 cần vài vòng diễn tập.
