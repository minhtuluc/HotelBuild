# ADR-015 — Quote và policy snapshot bất biến

**Trạng thái:** Đã chấp nhận cho thiết kế · **Ngày rà soát:** 2026-09-22. Làm rõ BR-RATE-15/16/17, BR-CANCEL-19; giữ quote Redis của ADR-004, không thêm bảng quote hay policy revision.

## Bối cảnh

Xoá quote khi cấu hình đổi làm mất cam kết 15 phút. Tự tính lại quote hết hạn rồi tạo booking khiến khách nhận giá chưa đồng ý. Đọc policy hiện tại lúc huỷ thay đổi nghĩa vụ đã bán. Ghi snapshot lại lúc callback khiến bằng chứng lúc hold mất tác dụng.

## Quyết định

1. RATE tạo PriceQuote có ID và payload bất biến trong Redis TTL 900 giây. Server gắn quote với principal/session và fingerprint: cơ sở, kênh, gói giá, từng loại phòng/số lượng, kỳ lưu trú, số khách và promotion. Quote chứa đủ facts giá và bản policy đã dùng; cấu hình có version để kiểm soát cập nhật nhưng không cần entity revision. Không ghép facts từ các lần cấu hình khác nhau trong một quote.
2. Thay giá/policy chỉ vô hiệu cache **ngữ cảnh tính quote mới**, không xoá quote đã phát hành còn hạn. Quote không đảm bảo tồn. Khi tạo booking, đọc quote, kiểm quyền/fingerprint và decisionAt < expiresAt sau khi khoá. Quote hết hạn, mất cache hoặc đầu vào thay đổi → không tạo booking với giá tự tính lại; trả kết quả yêu cầu quote mới và khách xác nhận. Chấp nhận chi phí khả dụng này để tránh thêm kho quote bền.
3. Một quote chỉ nhận vào một booking: snapshot ORIGINAL giữ quoteId/fingerprint, ràng buộc unique acceptance ở PostgreSQL (cột hoặc index biểu thức trên payload), không dựa riêng vào Redis GETDEL. Retry sau commit tìm booking qua idempotency/quote acceptance trước khi đòi quote Redis; quote hết TTL không ngăn replay. Quote chưa được nhận không có snapshot.
4. Khi rời DRAFT, ghi đúng một PriceSnapshot ORIGINAL, seq=1, cùng booking/assignment. Callback giữ nguyên snapshot. Snapshot có grossAmount, commissionAmount, policySnapshotJson; payloadJson có schemaVersion, engineVersion, quoteId/fingerprint, ratePlan với các quy tắc đã resolve, policy và mọi tier, timezone/check-in time, từng BookingRoom/đêm với gross/commission đã phân bổ, discount, settingId/version, nguồn giá và snapshot công suất. Lưu cả giá trị, không chỉ FK tới cấu hình live.
5. Use case cấu hình RATE/policy kiểm tier giảm dần/duy nhất, catch-all, tỷ lệ, min/max đêm và quan hệ RatePlan–policy; cập nhật có version/If-Match và audit. Quote/booking cũ đọc bản chụp, không cần giữ mỗi lần chỉnh sửa thành policy entity mới. Chủ sở hữu policy cấu hình theo kiến trúc; PAY tính tiền trên bản policy đã bán. UC cấu hình policy/rateplan theo danh mục yêu cầu (UC-RATE-06 khi tách riêng).
6. Huỷ, no-show và trả sớm dùng policy snapshot và giá từng dòng. Phí hoàn từ SystemSetting được chụp tại lúc tạo quyết định; duyệt/chi không tính lại phí. Bất khả kháng/walk-out được xét trước NONREF. Hoàn 100% là quyền hoàn phần tiền chưa hoàn/chưa giữ, không trả lặp.
7. Đổi ngày dùng quote mới được chấp nhận, kiểm tồn nguyên tử và append RESCHEDULE, giữ ORIGINAL. Giữ policy hợp đồng gốc nếu không có thay hợp đồng được chấp thuận tường minh; snapshot mới ghi rõ policy áp dụng, giá lưu trú, phí và phần chênh lệch giữ lại khi giá giảm. Theo BR-BOOK-12, giá giảm không sinh refund; không đổi deadline hold để gia hạn.
8. Huỷ một phần append PARTIAL_CANCEL, giữ giá dòng còn lại và lịch sử dòng huỷ. Sổ payment_allocations phân biệt tiền áp dụng cho từng nghĩa vụ/dòng, còn được hoàn, đã giữ/hoàn và không hoàn. Cơ sở phân bổ theo tỷ lệ giá snapshot trước thao tác; receipt/dòng có phân bổ bền và phần dư theo thứ tự dòng cố định. Lần huỷ tiếp theo dùng phần chưa tiêu thụ, không nhân lại toàn bộ paidAmount với totalAmount đã giảm. Rounding hoàn xuống 1.000 thực hiện sau chọn basis. booking_charges/payment_allocations là sổ quyết toán chung, không tạo sổ tiền thứ hai.
9. Promotion có maxUses được reserve cùng transaction nhận booking; hết hạn mức thì báo cần quote mới, không bỏ mã âm thầm. Các số liệu và thuật toán giá giữ đúng BR-RATE và bộ ví dụ tính tay hiện hữu.

## Phương án và hệ quả

Chọn snapshot đầy đủ + quote Redis bất biến thay vì thêm durable quote/revision tables. Mất Redis trước acceptance làm khách phải lấy quote mới; sau acceptance PostgreSQL giữ toàn bộ bằng chứng. Chọn version payload và quyền ghi hạn chế để tái lập quyết toán; không đọc live policy khi huỷ.

## Kiểm chứng và đồng bộ

DB/API đã thống nhất: quote Redis TTL; snapshot gross_amount, commission_amount, policy_snapshot_json; payload schemaVersion và từng dòng giá; booking_charges/payment_allocations; version/If-Match. Cần unique ORIGINAL/quote acceptance và snapshot append-only. Ca bắt buộc: sửa cấu hình giữa quote và hold; Redis mất trước/sau commit; quote hết hạn trong lúc chờ khoá; callback sau sửa giá; hai key nhận cùng quote; hai lần huỷ phần phòng không tái dùng tiền; mọi ví dụ giá cũ giữ kết quả.

**Tham chiếu:** [động giá](../../02-nghiep-vu/dong-gia.md), [chính sách huỷ](../../02-nghiep-vu/chinh-sach-huy-hoan-coc.md), [ADR-016](ADR-016-thanh-toan-hoan-tien.md), [thiết kế lớp](../thiet-ke-lop.md).
