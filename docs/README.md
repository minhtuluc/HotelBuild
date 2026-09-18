# Hệ thống Đặt phòng Khách sạn – Homestay (Chuỗi 3 cơ sở)

Tài liệu phân tích – thiết kế – kế hoạch triển khai cho đồ án môn **OOAD (Phân tích và Thiết kế Hướng đối tượng)**.

- **Chủ đầu tư:** Chủ chuỗi 3 cơ sở lưu trú (Pine Hill)
- **Phạm vi sản phẩm:** Web (khách đặt trực tiếp + back-office vận hành) và ứng dụng Android (lễ tân / quản lý cơ sở)
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
| 04 | [Thiết kế màn hình](04-thiet-ke/thiet-ke-man-hinh.md) | Sitemap, wireframe, luồng Android | ✅ |
| 05 | [Lộ trình](05-ke-hoach/lo-trinh.md) | Lộ trình 15 tuần, mốc, WBS, Gantt | ✅ |
| 05 | [Kế hoạch Sprint](05-ke-hoach/ke-hoach-sprint.md) | Backlog, user story, tiêu chí chấp nhận từng sprint | ✅ |
| 05 | [Quy tắc kỹ thuật](05-ke-hoach/quy-tac-ky-thuat.md) | Chuẩn code, git, review, DoR/DoD, chính sách test | ✅ |
| 05 | [Quy tắc nhóm](05-ke-hoach/quy-tac-nhom.md) | RACI, họp, quy trình đổi yêu cầu, sở hữu tài liệu | ✅ |
| 05 | [Kế hoạch kiểm thử](05-ke-hoach/ke-hoach-kiem-thu.md) | Chiến lược test, test case trọng yếu, kiểm thử tải | ✅ |
| 05 | [Quản lý rủi ro](05-ke-hoach/quan-ly-rui-ro.md) | Sổ rủi ro, giả định, câu hỏi mở | ✅ |
| 06 | [Ma trận truy vết](06-truy-vet/ma-tran-truy-vet.md) | BR → UC → API → Entity → Test (136 hàng, 14 bảng con) | ✅ |
| — | `05-ke-hoach/nhat-ky/` | Biên bản họp (`BB-YYMMDD`), phiếu đổi yêu cầu (`CRF-nn`), nợ kỹ thuật (`TD-nn`), quyết định ngoài ADR (`QĐ-nn`) — thư mục được tạo khi dự án khởi động (GĐ-0) | 🔄 |

**Quy mô bộ tài liệu:** 25 tệp Markdown · **14.898 dòng** · **78 sơ đồ Mermaid**. Nguồn chân lý nghiệp vụ: [02/quy tắc nghiệp vụ](02-nghiep-vu/quy-tac-nghiep-vu.md) — **136 quy tắc BR** · **52 use case** · **134 yêu cầu chức năng** · **40 yêu cầu phi chức năng** (8 nhóm) · **13 module**.

**Đã kiểm chứng tự động** (script trong CI theo [05/quy tắc kỹ thuật](05-ke-hoach/quy-tac-ky-thuat.md) §12):

| Phép kiểm | Công cụ | Kết quả |
|-----------|---------|---------|
| Cú pháp Mermaid | `mermaid.parse` (v11 + jsdom) trên **mọi** khối trong `docs/` | **78/78 hợp lệ, 0 lỗi** |
| Tham chiếu chéo định danh | script đối chiếu tập mã dùng ↔ tập mã định nghĩa | BR 136/136 · UC 52/52 · ACT 12/12 · NFR 40/40 · **0 tham chiếu hỏng, 0 mã mồ côi** |
| DDL + ràng buộc CSDL | PostgreSQL 16 thật, dựng từ chính DDL trong [04/csdl](04-thiet-ke/csdl.md) | 36 bảng, 34 chỉ mục, 8 trigger **chạy sạch**; **41/41 kịch bản ràng buộc đạt** |
| Số học nghiệp vụ | tính lại từng dòng bảng của ví dụ giá và bảng quyết định huỷ | ví dụ động giá **30/30 dòng đúng**; bảng quyết định huỷ **34 hàng** khớp |

## 2. Thứ tự đọc

- **Chủ đầu tư / giảng viên chấm nghiệp vụ:** 00 → 02 → 01 → 05/lo-trinh
- **Người phát triển:** 00 → 02/quy-tac-nghiep-vu → 03 → 04 → 05/quy-tac-ky-thuat
- **Người kiểm thử:** 02 → 01/yeu-cau-chuc-nang → 05/ke-hoach-kiem-thu → 06

## 3. Quy ước chung

1. Mã định danh (BR-, FR-, UC-, ENT-, ADR-, TC-, RSK-) là **duy nhất toàn bộ tài liệu**; không tái sử dụng, không đổi số sau khi đã tham chiếu.
2. Sơ đồ vẽ bằng **Mermaid** trong chính file Markdown — có thể diff, review, không cần công cụ ngoài.
3. Mọi con số nghiệp vụ chỉ được định nghĩa **một nơi duy nhất** (nguồn chân lý ở `02-nghiep-vu/quy-tac-nghiep-vu.md`); tài liệu khác tham chiếu mã BR, không chép lại giá trị.
4. Ngôn ngữ: tài liệu tiếng Việt, định danh trong mã nguồn và CSDL tiếng Anh.
5. Trạng thái tài liệu: ✅ đã chốt · 🔄 đang soạn · ⚠️ có câu hỏi mở chờ chủ đầu tư xác nhận (xem [00 §11](00-tong-quan.md)).

## 4. Quy trình cập nhật

Thay đổi yêu cầu → cập nhật BR trước → cập nhật UC/FR liên quan → cập nhật thiết kế → cập nhật ma trận truy vết. Không sửa thiết kế khi BR chưa đổi. Chi tiết ở [05/quy-tac-nhom](05-ke-hoach/quy-tac-nhom.md).
