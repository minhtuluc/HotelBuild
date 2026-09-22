# ADR-014 — Giao dịch cục bộ và quyền sở hữu tồn phòng

**Trạng thái:** Đã chấp nhận cho thiết kế · **Ngày rà soát:** 2026-09-22. Bổ sung ADR-003, thay phần khoá/hold làm nguồn chân lý trong ADR-004. Không thay số liệu BR.

## Bối cảnh

Khoá Redis có thể hết lease trước transaction. `SELECT FOR UPDATE` trên tập assignment rỗng không khoá được một ngày chưa bán. BOOK/INV/PAY cùng một PostgreSQL nhưng thiết kế cũ đẩy giải phóng phòng và tăng allotment sang listener, đồng thời cấm FK xuyên module; hai quyết định này không giữ được BR-INV-02, BR-BOOK-11.

## Quyết định

- Giữ modular monolith. Một application workflow sở hữu `UnitOfWork.run(tx)`; facade liên module nhận cùng `tx`, không mở transaction lồng độc lập. Domain chỉ trả quyết định; audit, history, tiền, tồn, outbox và kết quả idempotency commit cùng nhau. FK xuyên module được phép và cần thiết; quyền ghi vẫn thuộc module sở hữu.
- BOOK sở hữu hợp đồng `Booking`, `BookingRoom`, snapshot và lịch sử. INV sở hữu lịch cấp phát `RoomAssignment`, quota `ChannelAllotment`. PROP sở hữu `RoomBlock`; tạo block phải gọi kiểm tra INV trong cùng transaction. Quan hệ FK không biến toàn bộ cơ sở thành một aggregate.
- Dùng hàng có sẵn `properties` và `room_types` làm khoá thô cho quy mô 55 phòng; không thêm bảng room-day hay bảng hạn mức oversell. Khoá property tuần tự hoá kiểm tra oversell; khoá type bảo vệ kiểm tra tồn cả kỳ, kể cả khi chưa có assignment. Mọi lệnh ảnh hưởng tồn, quota, bảo trì, oversell, huỷ, đổi ngày, đổi phòng dùng cùng giao thức.
- Khoá theo thứ tự thống nhất: operation idempotency/inbox → bookings theo ID tăng dần → properties theo ID tăng dần (tuần tự hoá oversell) → room_types theo ID tăng dần → rooms theo ID tăng dần → quota/promotion theo ID tăng dần → Payment thu gốc theo ID tăng dần → RefundRequest theo ID tăng dần. Chỉ lấy nhóm cần dùng; cấm quay lại nhóm đứng trước. Lệnh nhiều booking xác định đủ tập ID trước khi khoá. RoomBlock đọc trước tập ảnh hưởng, khoá rồi đọc lại; nếu xuất hiện booking mới thì rollback và thử lại toàn bộ. Quy mô 55 phòng chấp nhận tuần tự hoá rộng để dùng đúng hàng đang có; chi tiết tại [CSDL §3.6](../csdl.md#36-hợp-đồng-ghi-dữ-liệu-và-giới-hạn-bảo-vệ).
- Đường ghi dùng primary, `READ COMMITTED` + khoá tường minh + constraint. Đọc lại mọi facts sau khi lấy khoá. Retry **toàn bộ** transaction khi deadlock/serialization conflict, giới hạn 3 lần có jitter; không retry HTTP/PSP trong transaction. `23P01` rollback và ánh xạ `E_INV_ROOM_TAKEN`; chọn phòng khác là lần thử cấp phát mới, không tiếp tục transaction đã lỗi.
- Mỗi `BookingRoom` là một đơn vị bán; DOR là giường. Mỗi assignment là khoảng nửa mở liên tục `[startDate,endDate)`, có thể nhiều đêm theo BR-BOOK-10; cùng phòng qua các đêm nếu khách chưa chấp thuận đổi phòng. Tồn từng đêm đủ là điều kiện cần, phải tìm được phương án gán thực tế cho toàn kỳ.
- Phòng thường chỉ `bedNo=0`; DOR chỉ `1..bedCount`. Thuê trọn DOR phải giữ tất cả giường. EXCLUDE ba cột không diễn giải `0` như wildcard. Thay loại bán/bedCount khi còn lịch gán tương lai bị chặn. Block cả dorm chặn mọi giường qua giao thức khoá chung.
- Hold hợp lệ ở cả `HELD` và `PENDING_PAYMENT`; nguồn bền là `Booking.holdExpiresAt` + assignment. Bắt đầu thanh toán không gia hạn hold. Kênh hold bằng 0 dùng hạn chờ thanh toán theo BR-PAY-05. Thời điểm quyết định lấy từ đồng hồ CSDL **sau khi khoá**, hợp lệ khi `decisionAt < deadline`; tại đúng deadline là hết hạn. Không dùng thời điểm bắt đầu transaction nếu đã phải chờ khoá.
- Job quét PostgreSQL mỗi 30 giây, cập nhật booking, release assignment, trả quota, history, audit và outbox trong cùng transaction. Redis mất sạch vẫn phải giải phóng trong SLA 60 giây; job đối chiếu 900 giây chỉ là sửa cache. API/worker chạy nhiều instance dựa vào khoá/CAS PostgreSQL, Redis chỉ giảm tải.
- Tồn thương mại theo BR-INV-01: `supply` là đơn vị ACTIVE không bị block (hợp các block); `demand` là BookingRoom hiệu lực của CONFIRMED/CHECKED_IN và HELD/PENDING_PAYMENT chưa hết hạn, gồm mọi kênh và oversold chưa gán. Sau move, nhu cầu theo cơ sở/loại thực cấp; phần chưa gán theo cam kết. `pool=supply-demand`, không trừ assignment thêm; `used` là demand của chính kênh. Bán thường dùng `max(0,min(pool,allotment-used))`, kênh trực tiếp không có quota riêng. Tập vật lý để gán = đơn vị ACTIVE trừ hợp block và assignment active. Hai phép kiểm cùng đạt mới được bán thường. Quota thay trong TX giữ/release, không tăng lại khi confirm; reconciliation sửa cache/bộ đếm dẫn xuất từ demand, không tạo nguồn tồn thứ hai.

## Điều chuyển và bù trừ

Phương án `PROPOSED` chưa giữ phòng. Khi thực thi, khoá đủ booking và lịch nguồn/đích, kiểm tra version, consent, scope và phòng đích lại; release cũ + insert mới + `RoomMove.EXECUTED` + giá giữ nguyên + outbox cùng transaction. Lỗi insert rollback khôi phục toàn bộ trạng thái cũ. Chỉ đánh dấu case `RESOLVED` khi đo lại `shortageCount=0` cho toàn bộ nhu cầu của case; một move không nhất thiết giải quyết cả case.

Process manager chỉ phục vụ chờ consent/phê duyệt và tác vụ ngoài DB. Sau commit, lỗi notification/PSP được retry hoặc đối soát, không tự đảo assignment đã giao cho khách. Muốn đảo move đã commit phải có lệnh move mới, kiểm tra lại tồn và quyền. Walk-out ghi huỷ + release + yêu cầu hoàn có reservation + nghĩa vụ bồi thường riêng; chi bồi thường không tính vào trần hoàn cọc. Case có thể hết thiếu phòng nhưng hồ sơ hoàn/bồi thường vẫn phải được theo dõi đến khi chi xong.

## Phương án và hệ quả

Loại khoá Redis làm hàng rào duy nhất và saga cho các bảng cùng PostgreSQL: thêm cửa sổ lỗi, không cần thiết cho quy mô 55 phòng. Chọn giao dịch đa aggregate có chủ ý cho bất biến tiền/tồn; đổi lại phải tuân thủ thứ tự khoá, giới hạn kích thước transaction và kiểm thử cạnh tranh. Không giữ khoá trong thời gian khách quyết định hay gọi mạng.

## Kiểm chứng và đồng bộ

DB dùng các hàng `properties`/`room_types` có sẵn để khoá thô, constraint đơn vị bán hợp lệ và FK. API cần version precondition cho lệnh thay booking/move, trả xung đột mà không âm thầm ghi đè. Các ca bắt buộc: 200 giữ cùng đơn vị chỉ 1 thắng; start-payment vs expiry; callback vs expiry; block vs hold; hai move ngược chiều; hai giường khác nhau cùng DOR hợp lệ, `bedNo=0` trên DOR bị từ chối.

**Tham chiếu:** BR-INV-01…07, BR-BOOK-07/08/11, BR-OVER-02/03/08/13; [mô hình miền](../../03-phan-tich/mo-hinh-mien.md), [sequence](../sequence-diagram.md). Cơ chế khoá hàng và deadlock dựa trên [PostgreSQL 16 — Explicit Locking](https://www.postgresql.org/docs/16/explicit-locking.html); tính chất EXCLUDE/FK theo [Constraints](https://www.postgresql.org/docs/16/ddl-constraints.html).
