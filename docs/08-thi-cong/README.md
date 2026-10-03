# 08 — Quy trình thi công

Áp dụng từ 02/10/2026 theo [QĐ-04](../05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md) (thay mô hình duyệt nhiều tầng của bản 01/10). Luật ngắn cho agent: [AGENTS.md](../../AGENTS.md). Đường tới deploy: [lộ trình](lo-trinh-den-deploy.md). Người thay vai lead: [sổ tay lead](so-tay-lead.md). Đặc tả F6: [backlog và ticket](backlog-f6-f7.md), [các điểm chưa chốt](f6-diem-cho-chot.md).

Nguyên tắc: **giao theo trình độ, mỗi đơn vị tự chịu chất lượng trong phạm vi của mình, một đầu mối báo cáo, lead chỉ xét bước cuối.** Hàng rào cứng chỉ giữ ở những chỗ mà sai thì không bù được khi vận hành (QĐ-04 mục "Không nới").

## 1. Vai trò

| Trình độ | Model / môi trường | Vai | Phạm vi chính |
|---|---|---|---|
| — | Claude Opus 5.5 / Kiro | Nhạc trưởng (lead) | Giao việc, gỡ vướng leo thang, xét cuối và merge, giữ lộ trình/backlog/quyết định |
| 1 | GPT-6.1 Sol / Codex | Kỹ sư chính | Mọi R2 lõi, tự viết test; có thể tách phần ít rủi ro cho DeepSeek kèm test khoá |
| 2 | DeepSeek V4.1 Flash / oh-my-pi | Kỹ sư | R1: hợp đồng thêm mới, CRUD không tiền/đồng thời, màn hình, seed, script; phần B của R2 khi Codex giao |
| 3 | Gemini 3.8 Flash / Antigravity | Kỹ thuật viên QA & tài liệu | R0, QA trình duyệt/Maestro, accessibility, i18n, bằng chứng nghiệm thu |

Agent không review chéo bắt buộc. Muốn ý kiến thứ hai thì tự nhờ (vd. DeepSeek nhờ Gemini chạy QA màn hình), không phải là điều kiện để nộp.

## 2. Hạng rủi ro → ai làm, lead xét sâu đến đâu

| Hạng | Ví dụ | Làm | Lead xét ở bước cuối |
|---|---|---|---|
| R0 | Tài liệu, copy, style, QA, kịch bản test | Gemini (hoặc bất kỳ) | CI xanh + liếc diff → merge |
| R1 | Màn hình, CRUD, client, hợp đồng thêm mới, seed | DeepSeek | CI xanh + đọc diff các file chính + kiểm báo cáo tự kiểm |
| R2 | Tồn/khoá, tiền, PSP, auth/RBAC, migration, idempotency/outbox, CI/hạ tầng | Codex | CI xanh + **chạy lại** phần rủi ro (migrate, endpoint, image, đồng thời) + đọc toàn bộ diff |

Không chắc hạng thì chọn hạng cao hơn. Ticket chạm vùng R2 dù một file là R2.

## 3. Vòng đời ticket

1. **Nhận việc**: lấy ticket đúng trình độ từ backlog. Chưa có đặc tả → tự soạn trong nhánh (AGENTS.md §1). Lead vẫn có thể viết trước cho việc khó hoặc chồng phạm vi.
2. **Làm** trong worktree `../wt/HB-nnn`, nhánh `ticket/HB-nnn-<slug>`. Vướng nhỏ thì tự quyết và ghi lại (AGENTS.md §4).
3. **Tự kiểm** đủ Định nghĩa xong (AGENTS.md §3), gồm chạy thật.
4. **Nộp**: mở PR theo mẫu, báo lead một lần.
5. **Lead xét cuối** theo §2: `PASS` → merge squash; lỗi nhỏ → lead sửa thẳng một commit rồi merge; lỗi đáng kể → `NEEDS_CHANGES` một lần, gom đủ mọi điểm.

## 4. Công cụ

- `pnpm check:scope` (chạy trong CI trên nhánh `ticket/*`): **chặn** file khoá và file bảo vệ; **cảnh báo** ngoài `allow`, vượt `max_lines`, đặc tả tự soạn.
- Vòng `codex-qc` trong oh-my-pi: chỉ chạy cho ticket R2 (phần B do DeepSeek làm). `AGENT_QC=always|never` ghi đè. Xem [omp-codex-qc](../07-ban-giao/omp-codex-qc.md).
- Nợ kỹ thuật: [no-ky-thuat.md](../07-ban-giao/no-ky-thuat.md).

## 5. Leo thang

Chỉ những việc trong danh mục "dừng và báo lead" của AGENTS.md §4. Một tin, có đề xuất cụ thể và lựa chọn mặc định; lead trả lời bằng quyết định, không hỏi lại. Việc lead cần người dùng quyết thì gom theo lô, mỗi câu có đề xuất (như phỏng vấn F1).

## 6. Kiểm soát chi phí

- Lead không đọc diff R0; R1 chỉ đọc file chính; chạy lại đầy đủ chỉ cho R2.
- Codex làm lõi R2 trên đường găng; việc R1 không giao cho Codex.
- Mỗi PR một vòng xét là mục tiêu: người làm gom đủ bằng chứng, lead gom đủ góp ý.
