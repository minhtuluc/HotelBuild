# Kết quả kiểm chứng thiết kế — 2026-09-22

## Phạm vi và phiên bản

Kiểm trên Windows, Node.js `v24.15.0`, npm `11.12.1`, trong working tree dựa trên commit `8fb3daced1fc4b974ff00fc7ae33250dd9270109`. Các thay đổi thiết kế và công cụ được kiểm trước khi tạo commit phát hành tài liệu; SHA nền chỉ nhận diện revision trước lượt tinh chỉnh này.

Repository chứa bản thiết kế và bộ kiểm tra, chưa chứa ứng dụng vận hành. Đây là bằng chứng kiểm tài liệu/schema, không phải nghiệm thu 139 quy tắc trên sản phẩm.

## Kết quả thực thi

Ngày 2026-09-22: `npm run check:docs`, `npm test` và `npm run test:postgres` đã kết thúc với exit code `0`. PostgreSQL thật là 16.15 trên Windows; runner tạo database tạm riêng và xoá sau kiểm thử. Kết quả dưới đây thay cho lần kiểm nhúng ban đầu:

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| Link và anchor nội bộ | PASS — 832 liên kết | Không xác minh nội dung trang ngoài repository; số lượng thay đổi do hợp nhất tài liệu tuần tự |
| Mermaid | PASS — 79 sơ đồ | Parse cú pháp, chưa kiểm bố cục bằng render |
| Mã và truy vết | PASS — 139 BR, 135 FR, 53 UC, 40 NFR, 217 TC; 139 dòng BR; 7 ngoại lệ có lý do | Kiểm định nghĩa TC và tham chiếu, gồm dải mã; chưa chứng minh mọi cạnh truy vết ngược đúng ngữ nghĩa hoặc test sản phẩm đã chạy |
| Công cụ kiểm tra | PASS — 8 test, 0 lỗi | Gồm phân biệt ngoại lệ chưa xử lý, nhận diện định nghĩa TC và phát hiện trùng |
| DDL và constraint | PASS — 30 test, 0 lỗi; 1 test SKIP | PGlite dùng PostgreSQL 17.5 nhúng, không phải PostgreSQL 16 server |
| DDL trích từ tài liệu | PASS — nạp 12 khối SQL thuộc CSDL §3 | Không chạy các snippet lặp và truy vấn minh hoạ như migration |
| PostgreSQL 16.15 thật | PASS — 31 test, 0 lỗi, 0 bỏ qua | Ca hai session quan sát lock wait thật: writer đầu commit thì waiter nhận 23P01; writer đầu rollback thì waiter thành công |

Các ca DB đã thực thi bao gồm chống trùng phòng/giường; khoảng ngày liền kề; bảo trì; quota và nhu cầu OTA vượt tồn; hold hết hạn; snapshot bất biến; idempotency có phạm vi; webhook inbox; phê duyệt hoàn độc lập; hạn mức phân bổ hoàn; audit chain; version và giao sự kiện cho từng consumer.

## Điểm đã khép lại trong lượt này

- Chạy DDL/constraint trên PostgreSQL 16.15 thật; bổ sung và chạy nhánh rollback trong ca cạnh tranh hai session.
- Viết lại tám luồng tuần tự; đồng bộ kiến trúc, bảng sự kiện và các hợp đồng lớp trọng yếu với ADR-014…017: transaction chung, policy snapshot, receipt muộn, refund reservation, Inbox/Outbox bền, consent trước execute và đo shortage trước RESOLVED.
- Mở rộng checker tới TC; tách ca tranh hold sang TC-BOOK-28 vì TC-BOOK-26 đã thuộc huỷ một phần, sửa tham chiếu UI/sprint/truy vết.
- Dọn hai dòng trust do bước cài PostgreSQL để lại; kiểm pg_hba_file_rules chỉ còn SCRAM, không có lỗi parse, mật khẩu sai bị từ chối. Không lưu credential vào repo.
- Sửa ba dòng BR-RATE-20, BR-BOOK-18, BR-PAY-11 bị ngắt khỏi bảng Markdown; giữ checker dựa trên bảng render thực tế.
- Sửa nhận diện ngoại lệ truy vết và thêm ca hồi quy, vẫn từ chối ngoại lệ còn ghi yêu cầu sửa.
- Đồng bộ tài liệu về 139 BR, 53 UC, 7 vai trò; cập nhật số UC của module RATE và ma trận quyền 56 tổ hợp.
- Thay `ActorContext.isManagerOrAbove()` bằng `hasPermission(permission)`, nêu rõ SYSADMIN không tự có quyền tài chính.
- Đồng bộ bảng phân công với người lập/người duyệt hoàn độc lập và ACK callback theo provider.
- Làm rõ thuê trọn DOR phải giữ từng giường trong cùng transaction; cập nhật các vấn đề readiness và cấu hình policy đã được giải quyết trong thiết kế.
- Đồng bộ blueprint sản phẩm thành một backend/worker dùng chung và bốn frontend deploy độc lập; bổ sung ADR-018, danh mục 13 màn hình Customer Android và ma trận release/test tương ứng.

## Việc còn cần bằng chứng

1. **NFR 200 yêu cầu và CI từ xa: NOT_RUN.** Test PostgreSQL thật hiện đã đạt cho hai writer; không thay bài tải 200 yêu cầu qua ứng dụng. Workflow có job PostgreSQL 16 nhưng chưa được chạy/publish từ phiên này.
2. **Nghiệm thu ngữ nghĩa:** các luồng rủi ro cao đã được đồng bộ trong lượt này. Kiểm tự động vẫn không thay được review nghiệp vụ của chủ đầu tư; chưa chứng nhận toàn bộ cạnh truy vết ngược hoặc bố cục sơ đồ đã render.
3. **Ứng dụng, PSP/OTA, tải và vận hành: NOT_RUN.** Chưa có application use case để chứng minh race expiry/callback, thanh toán/hoàn end-to-end, permission qua HTTP, restore, UAT hoặc NFR tải. Các test DB hiện tại không thay thế các cổng này.
4. **Quyết định nghiệp vụ mở:** theo mục câu hỏi mở trong tài liệu tổng quan. Kết quả kiểm xanh không tự phê duyệt giả định.

Lượt tiếp theo bắt đầu bằng `git status --short`, đọc báo cáo này và [hướng dẫn thi công](huong-dan-thi-cong.md), sau đó chạy lại lệnh cần thiết nếu nội dung đã thay đổi. Không cần clone lại hoặc ghi đè các thay đổi hiện có.
