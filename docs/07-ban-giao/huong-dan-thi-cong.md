# Bàn giao thiết kế và căn cứ thi công

Ngày rà soát: **22-09-2026**. Phạm vi là hoàn thiện thiết kế OOAD của Pine Hill. Các quyết định dưới đây là quyết định thiết kế trong repository; không giả lập biên bản phê duyệt của chủ đầu tư hoặc kết quả nghiệm thu phần mềm chưa xây dựng.

## 0. Blueprint sản phẩm khi bắt đầu thi công

Đội thi công phải dựng **một backend chung** và bốn frontend deploy độc lập:

| Surface | Thư mục dự kiến | Trách nhiệm |
|---|---|---|
| Customer Web | `apps/customer-web` | Khách tìm phòng, đặt, thanh toán, tra cứu, huỷ/đổi ngày |
| Customer Android | `apps/customer-android` | Cùng journey khách trên Android, secure storage và deep link PSP |
| Operations Web | `apps/operations-web` | Back-office: tồn, giá, booking, thanh toán, quá tải, báo cáo, quản trị |
| Operations Android | `apps/operations-android` | Tác nghiệp tại hiện trường: check-in/out, thu tiền, buồng phòng, đổi phòng |
| Shared backend | `apps/api` + `apps/worker` | API, transaction, domain use case, scheduler, outbox và adapter |

`packages/contracts` và `packages/api-client` là seam giao tiếp chung; `packages/ui-web` và `packages/ui-native`
chỉ chia sẻ token/primitive trình bày. Không đưa luật giá, policy, phân quyền hay trạng thái nghiệp vụ vào frontend.
Mọi frontend gọi cùng `/api/v1`; chi tiết layout/screen nằm trong [thiết kế màn hình](../04-thiet-ke/thiet-ke-man-hinh.md).

## 1. Nguồn có hiệu lực và cách đọc

1. [Tổng quan](../00-tong-quan.md) xác định biên hệ thống, actor, thuật ngữ và câu hỏi cần xác nhận.
2. [Quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md) xác định kết quả nghiệp vụ; [FR](../01-yeu-cau/yeu-cau-chuc-nang.md), [UC](../01-yeu-cau/mo-hinh-use-case.md), [NFR](../01-yeu-cau/yeu-cau-phi-chuc-nang.md) xác định hành vi và mức chất lượng cần nghiệm thu.
3. [Mô hình miền](../03-phan-tich/mo-hinh-mien.md) và [mô hình động](../03-phan-tich/mo-hinh-dong.md) xác định đối tượng, bất biến và vòng đời; ADR xác định quyết định kỹ thuật có lý do.
4. [API](../04-thiet-ke/api.md), [CSDL](../04-thiet-ke/csdl.md), [lớp](../04-thiet-ke/thiet-ke-lop.md), [sequence](../04-thiet-ke/sequence-diagram.md), [màn hình](../04-thiet-ke/thiet-ke-man-hinh.md) là hợp đồng giữa các nhóm thi công.
5. [Ma trận](../06-truy-vet/ma-tran-truy-vet.md) nối các mã với [kiểm thử](../05-ke-hoach/ke-hoach-kiem-thu.md). Có mã TC không đồng nghĩa TC đã chạy.

Nếu hai nguồn mâu thuẫn, mở một thay đổi thiết kế và sửa cả hai trước khi triển khai luồng bị ảnh hưởng. Không dùng một phụ lục để âm thầm vô hiệu hoá hợp đồng ở trang khác. Giá trị giả định được phép dùng cho demo khi ghi rõ, nhưng không được gọi là yêu cầu đã được chủ đầu tư chấp thuận.

## 2. Các lỗi thiết kế đã đưa vào đợt sửa

| Lỗ hổng phát hiện | Quyết định cần tuân thủ khi thi công | Bằng chứng phải có |
|---|---|---|
| Hold cùng kênh bị bỏ sót; booking OTA chưa gán biến mất khỏi tồn | Tính demand mọi kênh, gồm hold còn hạn và cam kết chưa gán; tách tồn thương mại khỏi đơn vị vật lý | Kiểm dữ liệu hỗn hợp, từng đêm, theo BR-INV-01 |
| Hai block hoặc block chồng assignment bị trừ hai lần | Tính tập đơn vị không bán được và nghĩa vụ phục vụ riêng | Một phòng block hai lần vẫn chỉ loại một đơn vị |
| Có chỗ mỗi đêm nhưng không có phòng liên tục cả kỳ | Tìm phương án gán cả kỳ; chia đoạn cần khách chấp thuận | Hai phòng trống xen kẽ không được hứa một phòng liên tục |
| Khóa tập assignment rỗng không chặn được người đặt mới | Khóa tài nguyên tồn có định danh ổn định; EXCLUDE là hàng rào cuối | Giao dịch cạnh tranh trên PostgreSQL 16 |
| Quote không khớp người/kênh/ngày, giá thay lúc thanh toán | Ràng buộc fingerprint và principal; snapshot điều khoản/giá khi chốt | Sai kênh/ngày bị từ chối, callback không tính lại giá |
| Ví dụ API tự CONFIRMED dù chưa thu cọc, tổng sau khuyến mãi lệch làm tròn | Response phản ánh đúng chứng từ và trạng thái; số học theo BR | Ca báo giá, hold, thu cọc riêng biệt |
| Sửa policy làm đổi tiền hoàn của booking cũ | Quyết toán từ snapshot đã chốt | Sửa policy rồi huỷ booking cũ vẫn giữ căn cứ ban đầu |
| Chưa có use case cấu hình policy/rateplan | UC-RATE-06 và validation đầy đủ trước publish | Mốc trùng/thiếu catch-all không được lưu |
| Hết hạn và callback tranh chấp; timeout bị hiểu là chưa thu | Khóa cùng aggregate, xác minh receipt, thu muộn đưa vào hoàn/đối soát | Không hồi sinh booking hết hạn; không tái chiếm phòng đã bán |
| Huỷ từng phòng dùng lại toàn bộ tiền thu | Phân bổ receipt theo dòng bất biến; theo dõi phần đã quyết toán | Hai lần huỷ không dùng cùng quyền hoàn |
| Hai yêu cầu hoàn đều thấy đủ tiền | Reserve từ yêu cầu đang mở trên booking và payment gốc | Hai yêu cầu 80% cùng nguồn không cùng được reserve |
| Timeout chi hoàn khiến gửi tiền lần hai | Payout có khóa bền, query/đối soát trước retry | Crash sau PSP thành công không tạo khoản chi thứ hai |
| Thu tiền, tiền hoàn, phạt và bồi thường lẫn nhau | Phân loại chứng từ và nghĩa vụ; balanceDue đã gồm các khoản nợ | Không cộng phạt hai lần, bồi thường không là hoàn cọc |
| HMAC/ACK PSP bị mô tả chung và ACK cả khi DB lỗi | Adapter theo giao thức, verify trước dedup, Inbox bền trước ACK | Fixture VNPay/MoMo, lỗi DB không success-ACK |
| Redis mất dữ liệu làm mất dedup/công việc | Idempotency, Inbox, Outbox và kết quả tiêu thụ bền | Replay sau mất cache/queue không tạo thêm tác động |
| Vai trò được hiểu như cấp bậc, lộ thông tin tài chính cho buồng phòng | Permission theo thao tác/phạm vi/đối tượng, projection theo nhiệm vụ | Ma trận role × operation × scope, thử ID người khác |
| Hai người sửa cùng đối tượng âm thầm ghi đè | Version/If-Match; recheck trong transaction | Client cũ nhận 412, không ghi đè |
| Dọn phòng bị đồng nhất với tồn tương lai | Chặn giao phòng chưa sạch, không trừ mọi đêm tương lai | Có thể đặt ngày sau nhưng không check-in khi chưa sẵn sàng |
| Báo cáo dùng hoa hồng hiện tại | Tính theo dòng snapshot, giải thích cơ sở và kỳ báo cáo | Sửa cấu hình hôm nay không làm đổi báo cáo giao dịch cũ |
| Ma trận trống, số lượng ghi cứng, kết quả kiểm chứng không có công cụ | Công cụ nằm trong repo; báo kết quả đúng môi trường và thời điểm chạy | Chạy lại lệnh kiểm tra, lưu log CI theo commit |

## 3. Đường thi công theo lát chức năng hoàn chỉnh

| Thứ tự | Lát bàn giao | Hợp đồng bắt buộc trước khi bắt đầu | Điều kiện hoàn tất |
|---|---|---|---|
| 1 | Định danh, seed cơ sở/loại phòng/đơn vị bán | Vai trò độc lập, scope, từ điển, migration, dữ liệu giả | Đăng nhập/thu hồi phiên, không truy cập chéo scope, không có dữ liệu thật trong seed |
| 2 | Tìm → quote → giữ chỗ → hết hạn | BR-INV, BR-RATE, BR-BOOK; ADR-014/015; snapshot | Một giá trên mọi client; tranh chấp không bán trùng; mất Redis vẫn giải phóng đúng hạn |
| 3 | Thu cọc → xác nhận → đối soát | Adapter PSP, ledger/allocations, idempotency, Inbox | Duplicate/late success/timeout được xử lý đúng, tiền và trạng thái truy nguyên được |
| 4 | Huỷ toàn phần/từng phần → duyệt → chi hoàn | Policy snapshot, reservation, maker-checker, payout operation | Không vượt tiền gốc, không chi hai lần, không dùng lại quyền hoàn |
| 5 | OTA → thiếu phòng → đổi/ghép/walk-out | Simulator contract, consent, phương án gán, transaction move | Nhu cầu ngoài hệ thống không mất, đổi thất bại giữ phòng cũ, chi phí tách riêng |
| 6 | Check-in/out, dọn phòng, báo cáo, operations web/Android và customer Android hardening | Readiness, balance, role projection, chỉ số báo cáo | Luồng khách hoàn chỉnh trên customer web/Android; offline không xác nhận tài chính/tồn; số báo cáo đối soát được |

Mỗi lát phải có migration, use case, hợp đồng DTO, màn hình, test hành vi, audit và xử lý thất bại. Không hoàn thành riêng toàn bộ UI hoặc toàn bộ controller rồi mới thử nghiệp vụ xuyên tầng.

## 4. Dữ liệu và hợp đồng cần đội thi công lưu tường minh

- **Snapshot:** schemaVersion, engineVersion, đầu vào quote, principal, từng phòng–đêm, allocation giảm giá, commission theo đêm, nguồn cấu hình, policy/tier và điều kiện đổi/huỷ, giờ nhận phòng đã chốt. Lưu tiền VND nguyên; định dạng JSON phải được validate và version trong `packages/contracts`.
- **Quyết định tiền:** nghĩa vụ gốc, receipt nguồn, số gộp/phí/net, nguồn sự kiện, phạm vi phòng, phần đã giữ/đã chi, người lập/duyệt/chi và bằng chứng. Không sử dụng một tổng paidAmount để thay thế sổ phân bổ.
- **Sự kiện:** eventId, aggregateId/version, schemaVersion, occurredAt, correlationId/causationId; consumer idempotent. Payload nghiệp vụ tối thiểu, không mang credential hay bản chụp giấy tờ.
- **Quyền:** route → permission → role set → property scope → ownership → state guard. Frontend ẩn nút chỉ là hỗ trợ UX; backend vẫn phải kiểm tra.
- **Dữ liệu ban đầu:** 3 cơ sở/55 phòng/75 đơn vị bán, kênh và policy mặc định là dữ liệu đề tài. Giữ mã nghiệp vụ ổn định; không biến số lượng này thành giới hạn hard-code của thuật toán.

DDL §3 là nguồn schema SQL tham chiếu; chỉ trích các khối của §3 theo thứ tự. Các đoạn §4/§7 minh hoạ lặp, §9 là truy vấn có tham số, không nối toàn bộ fence SQL thành một migration. `SET LOCAL app.actor_role` là ngữ cảnh do server đã xác thực cung cấp, **không** là hàng rào bảo mật nếu ứng dụng bị SQL injection; tài khoản runtime không có quyền owner/migration.

## 5. Cổng nghiệm thu và giới hạn bằng chứng

| Cổng | Bằng chứng | Không được suy diễn |
|---|---|---|
| Tài liệu | Kiểm link/anchor, Mermaid parse, định danh và truy vết | Sơ đồ parse được không chứng minh mô hình đúng nghiệp vụ |
| Schema | DDL dựng sạch và test constraint có ca âm/dương | PostgreSQL nhúng không chứng minh lock/concurrency trên máy chủ |
| Hợp đồng | OpenAPI/JSON schema thực thi, fixture provider được ký đúng, response theo permission | Danh mục endpoint Markdown chưa phải OpenAPI đã sinh hoặc adapter PSP đã nghiệm thu |
| Nghiệp vụ | Golden cases giá/huỷ và các journey của §3 trên application use case | Các hàm tính tay kiểm đúng không chứng minh tích hợp đúng |
| Cạnh tranh | PostgreSQL 16 + hai hoặc nhiều kết nối độc lập, 200 yêu cầu theo NFR; kiểm invariant sau kết thúc | Test tuần tự không phải test cạnh tranh |
| Vận hành | Restore thật vào môi trường tạm; đo RPO/RTO, SLA expiry/notification, diễn tập mất Redis/PSP | Có cấu hình backup không chứng minh khôi phục được |
| Sản phẩm | UAT với từng actor trên 4 frontend, đo NFR, xác nhận giả định | Tài liệu đủ mã không phải phần mềm sẵn sàng sản xuất |

Các script và workflow hiện có được liệt kê trong [package.json](../../package.json) và [quy tắc kỹ thuật](../05-ke-hoach/quy-tac-ky-thuat.md). Mỗi log nghiệm thu cần commit SHA, ngày chạy, môi trường, lệnh, kết quả và giới hạn. Dữ liệu kiểm thử sinh giả; không dùng tài khoản hoặc thông tin khách thật.

## 6. Các quyết định còn cần xác nhận trước sử dụng thực tế

Nguồn theo dõi là [00 §11](../00-tong-quan.md#11-câu-hỏi-mở-cần-chủ-đầu-tư-xác-nhận) và [sổ rủi ro](../05-ke-hoach/quan-ly-rui-ro.md). Chủ đầu tư cần xác nhận chính sách giá/phụ thu trẻ em, thời gian hoàn/hạn giữ chỗ, giới hạn/ngoại lệ bán vượt, bằng chứng đồng thuận và phạm vi nghiệp vụ thực tế. Các số liệu khảo sát giả định không phải số đo.

Tích hợp OTA hiện là simulator. VNPay/MoMo phải kiểm sandbox bằng credential của dự án trước khi nhận tiền thật. Lịch lưu giữ, quyền riêng tư và quy trình xử lý yêu cầu khách phải được người phụ trách pháp lý/đơn vị vận hành xác nhận theo bối cảnh triển khai; tài liệu đề tài không phải kết luận pháp lý. Đội thi công chưa được đánh dấu các cổng ứng dụng/cạnh tranh/vận hành đạt chỉ vì các kiểm tra tài liệu xanh.
