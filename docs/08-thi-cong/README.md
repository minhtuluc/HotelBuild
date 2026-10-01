# 08 — Quy trình thi công đa model

Áp dụng từ F1. Luật ngắn cho agent nằm ở [AGENTS.md](../../AGENTS.md); trang này là phần lý do và quy trình cho người điều phối.

Nguyên tắc: model đắt chỉ làm những việc ít khối lượng nhưng quyết định chất lượng (đặc tả, test khoá, duyệt); model rẻ làm phần khối lượng lớn. Không model nào tự duyệt việc của chính mình. "Xong" là cổng tự động xanh, không phải lời agent tự báo.

## 1. Vai trò

| Model / môi trường | Vai | Làm | Không làm |
|---|---|---|---|
| DeepSeek v4.1 Flash / oh-my-pi | Thợ chính, nhiều phiên song song | Viết code theo ticket, làm test khoá chuyển xanh, sửa theo review, migration CRUD, màn hình, cập nhật tài liệu thi công | Sửa test khoá, baseline hợp đồng, ADR; quyết định thiết kế |
| Gemini 3.8 Flash / Antigravity | Kiểm tra viên cấp 1, QA trình duyệt | Review cấp 1 mọi PR; QA web bằng browser agent (luồng, viewport, axe, WebKit); đối chiếu tài liệu ↔ code bằng ngữ cảnh dài; sinh test từ [kế hoạch kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md); viết nháp ticket R0 | Duyệt cuối ticket R2 |
| GPT-6.1 Sol / Codex | Chuyên gia lõi, cổng duyệt | Lõi R2: khoá tồn, giá/huỷ, ledger, idempotency, adapter PSP, RBAC; viết test khoá trước cho R2; duyệt PR R1/R2; vòng `codex-qc` cho nhánh R2 | Ticket R0; review mọi lần dừng của DeepSeek |
| Claude Opus 5.5 / Kiro | Kiến trúc sư, tech lead | Chia pha F thành ticket; viết đặc tả R2; xử lý mâu thuẫn tài liệu, ADR, cập nhật baseline; sửa công cụ/CI; nghiệm thu cuối pha; gỡ vòng lặp hỏng 2 lần | Code khối lượng lớn, review thường ngày |

## 2. Hạng rủi ro

| Hạng | Ví dụ | Đường đi | Duyệt để merge |
|---|---|---|---|
| R0 | Tài liệu thi công, copy, style, cấu hình app | DeepSeek → cổng → Gemini | Gemini `PASS` |
| R1 | Màn hình, CRUD, client, test | DeepSeek → cổng → Gemini → Codex | Gemini + Codex `PASS` |
| R2 | Tồn/khoá, tiền/hoàn, PSP, auth/RBAC, migration phá vỡ, hợp đồng API | Opus đặc tả → Codex test khoá (hoặc tự làm lõi) → DeepSeek phần còn lại (vòng `codex-qc` bật) → Gemini → Codex | Gemini + Codex `PASS` + Opus ký |

Không chắc hạng nào thì chọn hạng cao hơn. Ticket chạm vùng R2 dù chỉ một file thì là R2.

## 3. Vòng đời ticket

1. **Đặc tả** (Opus; Gemini có thể nháp R0): tạo `tickets/HB-nnn-<slug>.md` từ [mẫu](tickets/_mau.md) trên nhánh `lead/*`, merge vào `main` **trước** khi giao. `check:scope` đọc ticket từ nhánh nền nên người làm không tự nới phạm vi được.
2. **Test khoá** (R2, Codex; R1 tuỳ chọn): commit test thể hiện tiêu chí nghiệm thu, liệt kê trong `locked`. Test phải đỏ trước khi DeepSeek bắt đầu.
3. **Thi công** (DeepSeek): `git worktree add ../wt/HB-nnn -b ticket/HB-nnn-<slug> main`, làm trong phạm vi `allow`, chạy cổng, mở PR theo [AGENTS.md §4](../../AGENTS.md#4-báo-cáo-khi-dừng).
4. **CI**: `check:scope` + toàn bộ cổng. Đỏ thì quay lại bước 3, không review.
5. **Review cấp 1** (Gemini): đối chiếu diff với ticket và BR/UC/API trích dẫn; R1+ có màn hình thì chạy QA trình duyệt. Kết quả: `PASS` / `NEEDS_CHANGES` + danh sách lỗi chặn.
6. **Review cấp 2** (Codex, R1/R2): đúng đắn, cạnh tranh, bảo mật, tính đủ của test.
7. **Ký R2** (Opus) và **merge**: chỉ người dùng hoặc Opus merge; dùng squash, tiêu đề chứa `HB-nnn`.

Một ticket ≈ một PR ≤ 400 dòng (`max_lines`, không tính lockfile/OpenAPI sinh). Lớn hơn thì tách.

## 4. Song song và cô lập

- Mỗi phiên DeepSeek một worktree ngoài `src/`; hai ticket đang mở không được có `allow` chồng nhau (Opus kiểm khi giao).
- Vòng `codex-qc` trong oh-my-pi tự đọc hạng ticket từ tên nhánh: chỉ `R2` gọi Codex; R0/R1 ghi `SKIPPED` vào `.agent-qc/reviews.jsonl`. Ép chạy hoặc tắt bằng `AGENT_QC=always|never`. Chi tiết: [omp-codex-qc](../07-ban-giao/omp-codex-qc.md).
- Thay đổi hợp đồng API: chỉ ticket R2 có `unlock: packages/contracts/openapi.baseline.json`, do Opus duyệt.

## 5. Chuyển cấp

| Tình huống | Chuyển cho |
|---|---|
| Cùng một lỗi CI/review thất bại 2 vòng với DeepSeek | Codex (R1/R2) hoặc Gemini (R0) sửa trực tiếp |
| Codex hoặc Gemini thấy mâu thuẫn tài liệu, thiếu hợp đồng, cần đổi phạm vi | Opus |
| Opus cần quyết định nghiệp vụ, câu hỏi `Q-nn` mở, chi phí/thời hạn | Người dùng |

Khi chuyển cấp, ghi vào PR: đã thử gì, log lỗi, giả thuyết. Không giao lại nguyên văn cho model thấp hơn.

## 6. Kiểm soát chi phí

- Codex không review từng lần dừng của R0/R1; Opus không đọc diff R0/R1 trừ khi được chuyển cấp.
- Gemini gánh phần đọc nhiều (đối chiếu tài liệu, QA trình duyệt) vì rẻ và ngữ cảnh dài.
- Opus làm theo lô: chia cả một pha F thành ticket trong một phiên, nghiệm thu cuối pha trong một phiên.
- Theo dõi `.agent-qc/reviews.jsonl`: nhiều vòng `NEEDS_CHANGES` trên cùng loại ticket là dấu hiệu đặc tả kém, sửa ở mẫu ticket thay vì tăng số vòng.
