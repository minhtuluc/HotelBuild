# Hệ thống Đặt phòng Khách sạn – Homestay (Chuỗi 3 cơ sở)

Tài liệu phân tích – thiết kế – kế hoạch triển khai cho đồ án môn **OOAD (Phân tích và Thiết kế Hướng đối tượng)**.

**Bản rà soát thiết kế 22-09-2026.** Bắt đầu ở [hướng dẫn bàn giao thi công](07-ban-giao/huong-dan-thi-cong.md) để xem bất biến, các lỗi đã xử lý, thứ tự triển khai và cổng nghiệm thu. Repository chưa có ứng dụng; trạng thái tài liệu không phải bằng chứng nghiệp vụ đã được chủ đầu tư phê duyệt hoặc phần mềm đã qua UAT.

- **Chủ đầu tư:** Chủ chuỗi 3 cơ sở lưu trú (Pine Hill)
- **Phạm vi sản phẩm:** Một backend + worker dùng chung; bốn frontend độc lập gồm customer web, customer Android, operations web và operations Android
- **Quy mô nghiệp vụ:** 3 cơ sở – 55 phòng – 7 kênh bán
- **Ba bài toán trọng tâm:** (1) chính sách huỷ & hoàn cọc theo mốc thời gian; (2) giá theo mùa cao điểm và theo kênh bán; (3) ghép – đổi phòng khi quá tải

---

## 1. Bản đồ tài liệu

| # | Tài liệu | Nội dung | Trạng thái |
|---|----------|----------|------------|
| 00 | [Tổng quan](00-tong-quan.md) | Bối cảnh, phạm vi, actor, quy ước mã, từ điển thực thể, danh mục UC, stack, cấu trúc repo | ✅ |
| 01 | [Yêu cầu chức năng](01-yeu-cau/yeu-cau-chuc-nang.md) | FR theo module + MoSCoW + tiêu chí chấp nhận | ✅ |
| 01 | [Yêu cầu phi chức năng](01-yeu-cau/yeu-cau-phi-chuc-nang.md) | 40 NFR trong 8 nhóm: hiệu năng, độ tin cậy, bảo mật, khả dụng, bảo trì, tuân thủ, quan sát, nội địa hoá | ✅ |
| 01 | [Mô hình Use Case](01-yeu-cau/mo-hinh-use-case.md) | Sơ đồ UC, danh mục UC, đặc tả UC chính | ✅ |
| 02 | [Quy tắc nghiệp vụ](02-nghiep-vu/quy-tac-nghiep-vu.md) | Toàn bộ BR-* dạng kiểm thử được (nguồn chân lý) | ✅ |
| 02 | [Chính sách huỷ & hoàn cọc](02-nghiep-vu/chinh-sach-huy-hoan-coc.md) | Thang mốc thời gian, bảng quyết định, ví dụ số | ✅ |
| 02 | [Động giá](02-nghiep-vu/dong-gia.md) | Công thức giá, thứ tự ưu tiên, ví dụ tính | ✅ |
| 02 | [Quá tải – ghép & đổi phòng](02-nghiep-vu/qua-tai-ghep-doi-phong.md) | Cơ chế chống bán quá, thang xử lý, quy trình walk-out | ✅ |
| 03 | [Mô hình miền](03-phan-tich/mo-hinh-mien.md) | Domain model, class diagram mức phân tích | ✅ |
| 03 | [Mô hình động](03-phan-tich/mo-hinh-dong.md) | State machine, activity diagram, sequence mức phân tích | ✅ |
| 04 | [Kiến trúc](04-thiet-ke/kien-truc.md) | Kiến trúc module, hexagonal, triển khai, ADR | ✅ |
| 04 | [Thiết kế lớp](04-thiet-ke/thiet-ke-lop.md) | Class diagram mức thiết kế, ánh xạ design pattern | ✅ |
| 04 | [Sequence Diagram](04-thiet-ke/sequence-diagram.md) | Tuần tự chi tiết cho các UC rủi ro cao | ✅ |
| 04 | [Cơ sở dữ liệu](04-thiet-ke/csdl.md) | ERD, DDL, ràng buộc chống trùng phòng, chỉ mục | ✅ |
| 04 | [API](04-thiet-ke/api.md) | Hợp đồng REST, mã lỗi, idempotency, webhook OTA | ✅ |
| 04 | [Thiết kế màn hình](04-thiet-ke/thiet-ke-man-hinh.md) | Sitemap, wireframe, luồng customer/operations web và Android | ✅ |
| 05 | [Lộ trình](05-ke-hoach/lo-trinh.md) | Lộ trình 15 tuần, mốc, WBS, Gantt | ✅ |
| 05 | [Lộ trình thi công Web & Android](05-ke-hoach/lo-trinh-thi-cong-web-android.md) | Chia 4 frontend thành 10 pha F0–F9: màn hình `SCR-`, hợp đồng chặn, cổng hoàn tất, rủi ro nhân lực | ✅ |
| 05 | [QĐ-01 — Nền tảng F0](05-ke-hoach/nhat-ky/QD-01-nen-tang-f0.md) | Quyết định thi công F0: workspace pnpm, hợp đồng sinh tự động, header, tương thích bundler | ✅ |
| 05 | [QĐ-02 — Nền tảng backend](05-ke-hoach/nhat-ky/QD-02-nen-tang-backend.md) | Logger, migration baseline từ csdl §3, role migration/runtime, 54 mã lỗi, đề xuất F1 (phiên, BFF cookie, PIN) | ✅ |
| 05 | [QĐ-03 — Định danh, phiên F1](05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) | 10 quyết định phỏng vấn người dùng (cookie BFF, idle, khoá, PIN, gán vai trò, OWNER đầu tiên, quên mật khẩu email) + quyết định kỹ thuật F1 | ✅ |
| 05 | [Kế hoạch Sprint](05-ke-hoach/ke-hoach-sprint.md) | Backlog, user story, tiêu chí chấp nhận từng sprint | ✅ |
| 05 | [Quy tắc kỹ thuật](05-ke-hoach/quy-tac-ky-thuat.md) | Chuẩn code, git, review, DoR/DoD, chính sách test | ✅ |
| 05 | [Quy tắc nhóm](05-ke-hoach/quy-tac-nhom.md) | RACI, họp, quy trình đổi yêu cầu, sở hữu tài liệu | ✅ |
| 05 | [Kế hoạch kiểm thử](05-ke-hoach/ke-hoach-kiem-thu.md) | Chiến lược test, test case trọng yếu, kiểm thử tải | ✅ |
| 05 | [Quản lý rủi ro](05-ke-hoach/quan-ly-rui-ro.md) | Sổ rủi ro, giả định, câu hỏi mở | ✅ |
| 06 | [Ma trận truy vết](06-truy-vet/ma-tran-truy-vet.md) | BR → FR → UC → API → Entity → Test; kiểm tra bằng script | ✅ |
| 07 | [Bàn giao thi công](07-ban-giao/huong-dan-thi-cong.md) | Lỗi đã rà soát, thứ tự thi công, hợp đồng và giới hạn bằng chứng | ✅ |
| 07 | [Bằng chứng thi công F0](07-ban-giao/bang-chung-f0.md) | Kết quả chạy pha F0: cổng hợp đồng/ranh giới/kiểu/lint/test/build/E2E và bundle Android; danh mục NOT_RUN/BLOCKED | ✅ |
| 07 | [Rà soát F0](07-ban-giao/review-f0.md) · [Phản hồi rà soát](07-ban-giao/review-f0-response.md) | Phát hiện của QC và trạng thái xử lý F0-01…F0-08 kèm bằng chứng | ✅ |
| 08 | [Quy trình thi công đa model](08-thi-cong/README.md) · [Backlog](08-thi-cong/backlog.md) · [Mẫu ticket](08-thi-cong/tickets/_mau.md) | Vai trò DeepSeek/Gemini/Codex/Opus, hạng rủi ro R0–R2, vòng đời ticket `HB-nnn`, cổng `check:scope` | ✅ |
| 04 | [ADR](04-thiet-ke/adr/README.md) | Lý do chọn kiến trúc và các quyết định giao dịch, snapshot, thanh toán, sự kiện | ✅ |
| — | `05-ke-hoach/nhat-ky/` | Biên bản họp (`BB-YYMMDD`), phiếu đổi yêu cầu (`CRF-nn`), nợ kỹ thuật (`TD-nn`), quyết định ngoài ADR (`QĐ-nn`) — thư mục được tạo khi dự án khởi động (GĐ-0) | 🔄 |

**Nguồn thống kê:** công cụ kiểm tra đếm định nghĩa và sơ đồ trực tiếp từ tài liệu, không lấy số lượng ghi cứng làm bằng chứng độ phủ. Nguồn chân lý nghiệp vụ là [quy tắc nghiệp vụ](02-nghiep-vu/quy-tac-nghiep-vu.md); số mã, liên kết và coverage được báo mỗi lần chạy.

**Kiểm chứng có thể chạy lại** từ thư mục gốc bằng `npm ci` rồi `npm run check`. Kết quả hiện hành phải lấy từ log của đúng commit; các con số kiểm chứng trước đợt rà soát không được dùng thay cho lần chạy mới.

| Phép kiểm | Công cụ/lệnh | Phạm vi |
|-----------|---------|---------|
| Liên kết nội bộ và anchor | `npm run check:links` | Đích file/heading tồn tại; không xác minh nội dung website ngoài |
| Cú pháp Mermaid | `npm run check:mermaid` | Parse mọi sơ đồ; không kiểm bố cục render hay ngữ nghĩa nghiệp vụ |
| Định danh/truy vết | `npm run check:ids` | BR/FR/UC/NFR và coverage trong ma trận; không thay review nội dung ca thử |
| Công cụ trích và schema | `npm test` | Test công cụ và DDL §3 bằng PostgreSQL nhúng, không phải đo concurrency |
| PostgreSQL 16 máy chủ | `npm run test:postgres` trong workflow | Cần DB test riêng; chỉ khẳng định đạt khi có log chạy, không suy từ máy nhúng |

Các test ứng dụng/PSP thật, tải 200 yêu cầu, UAT và phục hồi thảm hoạ ở [kế hoạch kiểm thử](05-ke-hoach/ke-hoach-kiem-thu.md) vẫn là cổng cho giai đoạn thi công. Mục tiêu này không được đánh dấu đã đạt ở repo tài liệu.

## 2. Thứ tự đọc

- **Chủ đầu tư / giảng viên chấm nghiệp vụ:** 00 → 02 → 01 → 05/lo-trinh
- **Người phát triển:** 07 → 00 → 02/quy-tac-nghiep-vu → 03 → 04 → 05/quy-tac-ky-thuat
- **Người kiểm thử:** 02 → 01/yeu-cau-chuc-nang → 05/ke-hoach-kiem-thu → 06

## 3. Quy ước chung

1. Mã định danh (BR-, FR-, UC-, ENT-, ADR-, TC-, RSK-) là **duy nhất toàn bộ tài liệu**; không tái sử dụng, không đổi số sau khi đã tham chiếu.
2. Sơ đồ vẽ bằng **Mermaid** trong chính file Markdown — có thể diff, review, không cần công cụ ngoài.
3. Mọi con số nghiệp vụ chỉ được định nghĩa **một nơi duy nhất** (nguồn chân lý ở `02-nghiep-vu/quy-tac-nghiep-vu.md`); tài liệu khác tham chiếu mã BR, không chép lại giá trị.
4. Ngôn ngữ: tài liệu tiếng Việt, định danh trong mã nguồn và CSDL tiếng Anh.
5. Trạng thái tài liệu: ✅ có bản thiết kế để review · 🔄 dự kiến/đang soạn · ⚠️ có câu hỏi mở chờ chủ đầu tư xác nhận (xem [00 §11](00-tong-quan.md)). Việc xác nhận cần biên bản; im lặng không là chấp thuận.

## 4. Quy trình cập nhật

Thay đổi yêu cầu → cập nhật BR trước → cập nhật UC/FR liên quan → cập nhật thiết kế → cập nhật ma trận truy vết. Không sửa thiết kế khi BR chưa đổi. Chi tiết ở [05/quy-tac-nhom](05-ke-hoach/quy-tac-nhom.md).
