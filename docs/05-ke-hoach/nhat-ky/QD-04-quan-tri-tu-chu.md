# QĐ-04 — Quản trị tự chủ theo trình độ

**Ngày:** 02/10/2026 · **Người quyết định:** người dùng (chủ dự án); lead Opus soạn · **Thay thế:** phần duyệt nhiều tầng của [quy trình 08](../../08-thi-cong/README.md) bản 01/10/2026

## Bối cảnh

Sau khoảng 25 PR theo quy trình duyệt nhiều tầng (Gemini → Codex → lead), tiến độ chậm lại. Phần lớn số lần bị chặn không phải rủi ro chất lượng: ước sai `max_lines` (4 lần), thiếu file trong `allow` (2 lần), chưa có file đặc tả (2 lần), lỗ hổng hợp đồng nhỏ phát hiện khi làm. Còn lỗi thật (thiếu `prisma generate`, thiếu cờ `--conditions`, `HOST` cứng) đều do **chạy thật** phát hiện, không phải do thêm tầng duyệt.

## Quyết định

| # | Quyết định | Đánh đổi chấp nhận |
|---|---|---|
| 1 | Giao việc theo trình độ: **GPT-6.1 Sol > DeepSeek V4.1 Flash > Gemini 3.8 Flash**. Việc càng rủi ro càng giao cho người giỏi hơn, và người đó tự làm trọn từ đầu đến cuối | Mất lớp "người khác viết test, người khác làm" ở R2, trừ khi Codex tự chọn tách |
| 2 | Mỗi đơn vị **tự đảm bảo chất lượng** theo Định nghĩa xong của AGENTS.md §3 trước khi nộp. Bỏ bắt buộc review chéo giữa các agent | Lỗi chỉ người khác mới thấy sẽ đến lead muộn hơn |
| 3 | **Một đầu mối báo cáo duy nhất: lead (Opus)**, xét ở bước cuối với độ sâu theo hạng rủi ro | Lead là điểm nghẽn nếu vắng; sổ tay lead quy định người thay vai |
| 4 | `check:scope` chỉ chặn file khoá và file bảo vệ; ngoài `allow`, vượt `max_lines`, đặc tả tự soạn chỉ **cảnh báo** và phải giải trình trong PR | Phạm vi PR có thể phình; lead từ chối ở bước cuối nếu không hợp lý |
| 5 | Danh sách file bảo vệ rút gọn: bỏ tài liệu thiết kế 03–04, `package.json`, `pnpm-workspace.yaml`, `eslint.config.mjs`. Giữ: AGENTS.md, `docs/08-thi-cong/`, tổng quan, yêu cầu, quy tắc nghiệp vụ, baseline hợp đồng, `packages/config`, CI, công cụ QC | Thiết kế 03–04 có thể bị sửa theo mã; lead soát ở bước cuối |
| 6 | Codex và DeepSeek được **tự soạn đặc tả** từ dòng backlog ngay trong nhánh của mình khi lead chưa viết. Gemini tự soạn được ticket R0 | Đặc tả chưa được duyệt trước; lead duyệt cùng PR |
| 7 | Vướng nhỏ thì **tự quyết, ghi lại, làm tiếp** (AGENTS.md §4); chỉ dừng với danh mục leo thang. Thứ chưa làm kịp mà không ảnh hưởng tiền/tồn/bảo mật thì ghi vào [nợ kỹ thuật](../../07-ban-giao/no-ky-thuat.md) | Nợ kỹ thuật tăng; phải trả trước go-live nếu thuộc cổng go-live |

## Không nới

Các điểm sau giữ nguyên dù tốn thời gian, vì sai thì không bù được khi vận hành: chống bán trùng phòng, tiền (thu/hoàn/chi một lần), snapshot giá và chính sách bất biến, phân quyền, bí mật và PII, hợp đồng API đã phát hành không bị phá vỡ, CI phải xanh trước merge, 14 cổng go-live của [lộ trình](../../08-thi-cong/lo-trinh-den-deploy.md#4-cổng-go-live).
