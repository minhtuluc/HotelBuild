# ADR-016 — Thu muộn, giữ hạn mức hoàn và đối soát chi tiền

**Trạng thái:** Đã chấp nhận cho thiết kế · **Ngày rà soát:** 2026-09-22. Cụ thể hoá BR-PAY-03/05/07/08/09 và BR-CANCEL-15…19; không đổi tỷ lệ/giới hạn nghiệp vụ.

## Bối cảnh

Timeout là việc hệ thống ngừng chờ, không phải bằng chứng PSP chưa thu. Hai refund cùng được duyệt dựa trên một `paidAmount` có thể chi vượt trần. Một booking có nhiều receipt/phương thức nên `RefundRequest.paymentId` đơn lẻ không đủ. Gửi lại sau timeout có thể trả tiền lần hai.

## Quyết định về khoản thu

- `Payment` là aggregate chứng từ giao dịch có vòng đời. Amount/type/method/orderRef bất biến sau khởi tạo; trạng thái thay có history/audit. Khi đã `SUCCEEDED`, không sửa/xoá chứng từ thu để biểu diễn hoàn; tạo chứng từ `REFUND` riêng. `REVERSED` không được gán lên khoản thu gốc chỉ vì có refund.
- Mỗi intent có orderRef bền trước gọi PSP; chỉ một intent cọc đang hoạt động cho booking/revision. Retry tạo URL/query dùng lại intent. Timeout/huỷ intent lưu lý do kỹ thuật; không ngăn tiếp nhận bằng chứng thu thành công hợp lệ sau đó.
- Callback hoặc query xác minh thành công khoá booking và receipt, kiểm provider/orderRef/amount/currency, chống trùng bằng khoá giao dịch PSP bền. `PENDING → SUCCEEDED` và `FAILED(local_timeout) → SUCCEEDED` hợp lệ khi có bằng chứng PSP. Callback thất bại đến sau thành công chỉ được ghi inbox/history, không hạ trạng thái. Đối soát có mâu thuẫn thì giữ trạng thái tài chính đã chứng minh và mở exception.
- Booking chỉ confirm khi còn `HELD/PENDING_PAYMENT`, còn hạn tại điểm lấy khoá, đủ cọc và assignment/quota vẫn hợp lệ. Callback tới hạn nhưng job chưa chạy cũng phải thực hiện expiry trong cùng transaction trước quyết toán. Booking đã đóng không được hồi sinh.
- Khoản thu sau expiry/cancel là receipt thật: ghi nhận đúng một lần, cộng số đã thu, phân loại tiền thu muộn chưa áp dụng cho lưu trú, tạo `RefundRequest` lý do `SYSTEM` liên kết receipt/inbox gốc. Hoàn đúng khoản thu muộn, không áp tier/phí/phạt huỷ; giữ hạn mức và phê duyệt như mọi khoản chi. Không tạo booking/hold thay khách. Khoản thu thuộc revision cũ khi booking vẫn hoạt động được đưa vào đối soát, không tự confirm revision mới; hoàn hoặc áp dụng phải có quyết định có quyền, ghi audit.
- `paidAmount`/`refundedAmount` là tổng dẫn xuất từ bút toán đã thành công có phân loại, không cộng cả dòng chi REFUND/COMPENSATION như tiền thu. Tiền được giữ để hoàn/tiền chưa áp dụng không được tính là cọc khả dụng. Số dư còn nợ chỉ cộng penalty một lần theo BR-PAY-02; phép tính check-in dùng số dư chuẩn hoá do PAY trả.

## Quyết định về refund

`requestedAmount` và `approvedAmount` là **tiền hoàn gộp (GROSS)**. `netRefund=max(0,coalesce(approvedAmount,requestedAmount)-refundFee)`; reservation và tổng allocation chi luôn theo **NET**. Phí chụp một lần, không trừ lại khi chi. Người duyệt độc lập MANAGER hoặc OWNER có permission/scope và khác người tạo; hai cấp là maker–checker, không phải MANAGER rồi OWNER. Kiểm ngưỡng trên 5.000.000 theo net của toàn sự kiện, không tách hồ sơ né ngưỡng. ACCOUNTANT chi sau APPROVED, không tự có quyền duyệt. Requester dùng `requesterType=USER/GUEST/SYSTEM` + `requesterId`; `requestedBy` staff FK có thể rỗng, không gán người duyệt thành người tạo để lấp FK.

`RefundRequest` sở hữu các allocation/leg liên kết từng `Payment` thu gốc. Một yêu cầu có thể chi qua nhiều phương thức. Khoản thu tiền mặt hoàn bằng chuyển khoản theo BR-PAY-08; OTA_COLLECT phải qua nghĩa vụ đối soát/hoàn của OTA, không gọi VNPay/MoMo cho tiền OTA giữ. Amount của một leg không vượt dư hoàn của receipt gốc.

Với booking B và từng receipt P, luôn giữ:

```text
refundedSucceeded(B) + refundReserved(B) <= collectedSucceeded(B)
refundedSucceeded(P) + refundReserved(P) <= collectedSucceeded(P)
```

Hai bất biến được kiểm tra dưới khoá booking + receipt gốc + refund, không dùng tổng SUM không khoá. Ngoài trần tiền, mỗi quyết định hoàn có `sourceOperationId` và tập dòng nghiệp vụ duy nhất; allocation basis của [ADR-015](ADR-015-quote-policy-bat-bien.md) ngăn xin lại cùng quyền hoàn bằng Idempotency-Key mới.

| Thao tác | Reservation và trạng thái |
|---|---|
| Tạo request | Trong TX huỷ/trả sớm/walk-out/thu muộn: tính quyền hoàn GROSS, reserve `max(0,requestedAmount-refundFee)` trên từng receipt, tạo PENDING, audit/outbox. Net bằng 0 chỉ ghi quyết định, không tạo lệnh chi |
| Duyệt | Khoá và recheck; approvedAmount GROSS không vượt requestedAmount, net sau phí phải dương; giữ `max(0,approvedAmount-refundFee)`, trả phần giảm NET; lưu lý do nếu giảm. Muốn tăng phải tạo quyết định mới và kiểm lại cơ sở/trần, không sửa số đã duyệt |
| Từ chối/rút PENDING | `REJECTED/CANCELLED` và trả reservation trong cùng TX; không tự khôi phục booking |
| Chuẩn bị chi | Chỉ `APPROVED`; tạo operation/leg và `Payment REFUND PENDING` bền, khoá duy nhất theo request + receipt + leg; commit rồi gọi PSP/chuyển khoản |
| Đã chi một leg | Xác minh thành công; cùng TX ghi REFUND SUCCEEDED, chuyển reservation leg thành refunded, giữ các leg khác. Request vẫn APPROVED tới khi tất cả leg thành công |
| Timeout/kết quả không rõ | Giữ reservation và request APPROVED; operation ở trạng thái kỹ thuật UNKNOWN để query/đối soát. Không tạo leg/key mới, không giải phóng hạn mức |
| PSP xác nhận chưa chi/thất bại dứt điểm | Giữ reservation của request APPROVED, retry có kiểm soát trên cùng nghĩa vụ; chỉ tạo attempt mới sau xác minh attempt cũ không thể thành công. Không huỷ APPROVED trái BR-CANCEL-18 |
| Hoàn tất | Tất cả leg thành công → `PAID`; paidAt, audit, outbox trong cùng TX. Callback lặp không cộng lại refunded |

Trạng thái `READY/IN_FLIGHT/UNKNOWN/SUCCEEDED/FAILED_FINAL` thuộc **operation kỹ thuật**, không thêm vào enum `RefundStatus`. Worker có lease/version; worker cũ không được commit kết quả nếu đã mất lease. Lease hết hạn không chứng minh PSP chưa chi. Provider không hỗ trợ idempotency hoặc query tin cậy thì chuyển đối soát thủ công, không tự gửi lại. Chuyển khoản thủ công có mã chứng từ ngân hàng duy nhất và xác nhận kế toán; việc bấm nút chi không chứng minh đã chuyển tiền.

## Phương án và hệ quả

Chọn reserve từ PENDING để yêu cầu đã được ghi nhận có nguồn tiền rõ; đổi lại request chờ duyệt giữ hạn mức, cần màn hình/metric tuổi hồ sơ. Loại kiểm trần chỉ lúc chi và gọi PSP trước commit intent. Không tự rollback khoản chi ngoài hệ thống; sửa sai dùng chứng từ điều chỉnh có kiểm toán.

## Kiểm chứng và đồng bộ

DB/API cần: nguyên nhân timeout, orderRef và provider transaction unique lâu dài; refund allocation nhiều receipt; reservation; operation/attempt bền, immutable decision/sourceOperationId; biểu diễn khoản thu muộn và tiền chưa áp dụng. Ca bắt buộc: hai request mỗi cái 80% số thu chỉ một được reserve; hai worker chi một request; crash sau PSP thành công trước commit; refund từng phần qua hai PSP; late success sau EXPIRED; failure sau success; hai lần huỷ từng phòng; timeout refund không trả reservation; khoản chi bồi thường không làm tăng refundedAmount.

**Tham chiếu:** [máy trạng thái](../../03-phan-tich/mo-hinh-dong.md), [sequence](../sequence-diagram.md), [chính sách huỷ](../../02-nghiep-vu/chinh-sach-huy-hoan-coc.md), [ADR-014](ADR-014-giao-dich-ton-phong.md), [ADR-017](ADR-017-inbox-outbox-idempotency.md).
