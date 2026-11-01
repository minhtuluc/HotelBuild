# F6 — các điểm lead cần chốt trước giao phần liên quan

Soạn ngày 02–03/10/2026, nguồn tại main của HotelBuild. **Trạng thái: 8/8 điểm đã chốt ngày 01/11/2026.** Các
đề xuất dưới đây đã được lead chốt; chỗ nào phải sửa BR/DDL/hợp đồng thì ghi rõ ở cột “Chốt” và mục quyết
định chi tiết. Công bố đặc tả không mở khoá các nhánh đang BLOCKED và không xác nhận F6/M7 đã nghiệm thu.

Người dùng yêu cầu Codex tích hợp F6 khi Opus không còn; Codex thực hiện vai lead thay thế theo [sổ tay lead §1](so-tay-lead.md#1-ai-thay-vai-lead). Người tiếp nhận lead phải chốt từng điểm ảnh hưởng trước giao phần tương ứng. Owner `opus` của HB-195 biểu diễn vai lead nghiệm thu; áp dụng quy tắc thay thế này cho tới khi có lead mới.

| Mã | Điểm cần quyết định | Nguồn và ảnh hưởng | Đề xuất cụ thể | Chốt — 01/11/2026 |
|---|---|---|---|---|
| F6-D01 | MERGE_CONNECTING một hay hai booking | BR §9.4 mô tả ghép hai phòng cho gia đình/nhóm; chuyên đề §8.1 ghi cùng một booking, không cần hai consent; `room_merges` bắt hai booking khác nhau, API body chỉ có một roomId. Chặn phần connecting HB-120/121/123/124/125/137 và TC-OVER-12. | Chọn mô hình một booking có hai BookingRoom/two reciprocal rooms như chuyên đề; SHARE vẫn hai booking độc lập. Lead cập nhật nguồn nghiệp vụ chi tiết nếu chọn khác, rồi API/DDL/consent cùng mô hình; không tạo booking giả để thoả CHECK. | Một booking, hai phòng (hai `BookingRoom`); SHARE vẫn hai booking. DDL connecting cho `secondary_booking_id` NULL, consent chỉ áp cho SHARE. |
| F6-D02 | “Hoàn 100%” walk-out khi paid có lẻ hoặc refundFee>0 | BR-CANCEL-05 làm tròn xuống 1.000; BR-CANCEL-11 cho phí cấu hình; BR-CANCEL-14/BR-OVER §9.2 nói 100%, nhưng chỉ BR-CANCEL-13 ghi miễn phí. Chuyên đề ghi floor(paid/1000)*1000=paid sai với5001. | Giữ baseline confirmed engine hiện hành trong lúc review: paid5001→gross5000; nếu fee1000 thì net4000. Lead chốt walk-out tiếp tục policy rounding/fee hay là ngoại lệ trả đúng5001/miễn phí; lựa chọn ngoại lệ phải sửa BR/QĐ và engine có test trước khi payout. Chặn nhánh chưa rõ, không dùng tiền tròn của TC để bỏ biên. | Giữ BR-CANCEL-05/11: floor 1.000 + phí; “100%” = refundPercent, không miễn phí/không trả đúng đồng lẻ. 5.001→5.000; phí 1.000→4.000. |
| F6-D03 | Chiết khấu ghép có thay nghĩa vụ/tiền khách và làm tròn ra sao | BR-OVER-15 giữ doanh thu phòng, ghi discount riêng. Chuyên đề ví dụ 1.454.000−290.800=1.163.000 và “tính lại giá”; phép trừ ra1.163.200, BR-GEN-03 làm tròn giá lên. | Giữ PriceSnapshot/doanh thu nguyên và discountAmount290800/bên,581600 tổng. Lead xác nhận cách chiết khấu được áp vào nghĩa vụ/thu/hoàn, không tự sửa snapshot hoặc lấy1.163.000 làm phải thu; đồng bộ ví dụ protected. | Doanh thu/PriceSnapshot nguyên; discount 290.800/bên; phải thu = floor1000(1.454.000−290.800) = **1.163.000** (BR-RATE-01 b.11). Không dùng 1.163.200, không làm tròn lên. |
| F6-D04 | DDL bắt approved_by cho mọi move/merge | BR-OVER-06/09 cần duyệt chi phí và bất khả kháng CHECKED_IN, BR-OVER-14 cần duyệt ghép khác giới; chuyên đề §10.3 cho SHARE cùng giới không cần manager. Baseline/API §3.10 lại buộc mọi ca có duyệt. | Lead đồng bộ thiết kế theo BR: move chưa check-in cùng cơ sở zero-cost và SHARE cùng giới đủ consent không có bước duyệt quản lý giả. HB-121 sửa guard có điều kiện; HB-124 vẫn chặn mọi chi phí/khác giới/CHECKED_IN thiếu duyệt, scope/PIN giữ nguyên. | Chỉ bắt `approved_by` khi có chi phí, CHECKED_IN bất khả kháng, khác giới/UNSPECIFIED, khác thành phố. Cùng cơ sở zero-cost và SHARE cùng giới đủ consent: không duyệt. |
| F6-D05 | Cách bàn giao test A đỏ mà merge guard chỉ nhận CI xanh | Sổ tay lead §3.6 đòi merge A đỏ trước B; AGENTS §3/sổ tay §4 và merge guard không merge CI đỏ. Chặn thủ tục giao HB-124/126/128/131, không phải lý do bỏ test. | A bàn giao SHA/log đỏ bất biến, B tích hợp trên SHA đó; lead tổ chức scope và PR tích hợp A+B với toàn bộ CI xanh, các test A giữ nguyên. Lead sửa hướng dẫn/manifest phù hợp trước giao; không skip, nới assertion hoặc sửa CI để merge A đỏ. | A đỏ chỉ nằm trên nhánh; lead ghim sha vào **mọi** ticket khoá tệp; B cherry-pick A + code, PR A+B xanh mới merge. Không skip/nới/đổi CI. |
| F6-D06 | Quyền chi và adapter COMPENSATION | `/payments` catalogue có COMPENSATION nhưng HB-096 chỉ thu tại quầy; HB-099/100 chỉ RefundRequest/REFUND. API §6.3 chỉ ACCOUNTANT chi bồi thường. | Bổ sung route compensation-payments trong HB-120, schema/link/unique ở HB-121, locked test ở HB-124, phần B HB-125. Lead xác nhận phương thức/adapter hỗ trợ chi hoặc ghi nhận chi có bằng chứng, không dùng quỹ refund giữ theo Payment gốc cho COMPENSATION. Chỉ ACCOUNTANT/PIN/scope/số tiền đã duyệt, pending/timeout có operation bền. | Route compensation riêng, ACCOUNTANT+PIN, amount từ RoomMove đã duyệt, `Payment` COMPENSATION + `room_move_id` unique; không dùng quỹ REFUND, không adapter PSP mới. |
| F6-D07 | Ranh giới F6 với nền worker/NOTI, guard F4 và đóng ca tự động | Worker chưa có reusable server runtime; HB-028 chỉ mail reset, NOTI HB-168 ởF8; HB-076/077 chưa nêu guard BR-OVER-01/02 trong AC. Nếu giữ nguyên sẽ thiếu chứng minh M7. Chuyên đề quá tải §5 cho job tự đóng ca tương lai khi hết thiếu, BR-OVER-16 cấm tự đóng ca ngày đã qua; đoạn sau thang quét lại nói BR-OVER-16 tiếp quản ngay sau T−24h, còn DDL yêu cầu resolvedBy tham chiếu users cho mọi RESOLVED. Nhánh tự đóng ca tương lai HB-126/127 cần chốt ranh giới và actor bền, không mặc nhiên cấm mọi ca tự đóng hoặc gán người xử lý giả. | HB-127 sở hữu composition seam/build-dist; HB-130 thêm consumer thông báo điều chuyển tối thiểu dùng Mailer HB-028, F8 reuse. HB-122 cung cấp pure active-oversell guard; lead giao đầu nối vào F4 trong transaction booking có khoá, có TC-OVER-03/04 thật, không tự sửa phần F4 đang thi công. Đồng bộ ranh giới tự đóng ca hết thiếu trước ngày/T−24h và resolvedBy của worker trong nguồn nghiệp vụ/DDL; ca ngày đã qua luôn ESCALATED và không tự đóng. Giữ nhánh tự đóng ca tương lai BLOCKED trước test A cho tới khi có quyết định rõ. | Dùng NotificationGateway + worker hiện có; HB-126 nối guard F4 bằng lời gọi mỏng; tự đóng ca chỉ trước T−24h và thiếu = 0, actor SYSTEM bền (`resolution_source`), không user giả. |
| F6-D08 | Điểm còn thiếu của bảng keepScore | BR §9.3 mô tả đủ tổng/đủ cọc/chưa trả, chưa nêu trả dương nhưng dưới cọc. Nếu tổng/cọc bằng0, các điều kiện cũng có thể chồng. | Lead chốt thứ tự nhánh và điểm cho trả dương dưới cọc, total/deposit0 bằng ví dụ cụ thể trước khoá test; không tự coi khoản nhỏ là đã cọc hoặc tự suy điểm0 thành BR đã chốt. | paid=0→0; đủ tổng→20; ≥ cọc (>0) hoặc cọc=0 và đã trả>0→10; 0<paid<cọc→0. BR-OVER-12 lọc trước; score↑, createdAt↓, seq↑. |

## Quyết định chi tiết (01/11/2026)

Người chốt: lead tạm thời (DeepSeek) theo QĐ-04. Nguồn ưu tiên là
[quy tắc nghiệp vụ](../02-nghiep-vu/quy-tac-nghiep-vu.md); tài liệu 03–04 lệch thì sửa theo QĐ-05, không sửa
BR cho khớp thiết kế cũ. Các quyết định dưới đây có hiệu lực ngay, không cần họp thêm.

### F6-D01 — `MERGE_CONNECTING` là **một** booking

- Một booking giữ **hai `BookingRoom`** ở hai phòng thông nhau (mỗi phòng một `RoomAssignment`); không tạo
  booking thứ hai, không có `consentPrimary`/`consentSecondary` của bên thứ hai. `MERGE_SHARE` vẫn là hai
  booking độc lập như BR-OVER-13.
- HB-120: body connecting dùng `bookingId` + hai `roomId` (không `secondaryBookingId`, không consent);
  `POST /room-merges/{id}/consent` chỉ có nghĩa với SHARE. HB-137 dựng màn hình theo mô hình này.
- HB-121: `room_merges.secondary_booking_id` cho phép `NULL`; thêm `secondary_room_id` cho connecting;
  `ck_room_merges_distinct` chỉ áp khi secondary khác NULL; `ck_room_merges_consent` chỉ áp cho
  `move_type = 'MERGE_SHARE'`. Unique "một merge ACTIVE" phải tính cả connecting theo booking/phòng.
- Không dùng booking giả để thoả CHECK cũ. HB-123 `evaluateRoomMerge(MERGE_CONNECTING)` đã nhận hai phòng,
  giữ nguyên.

### F6-D02 — Walk-out giữ nguyên chính sách làm tròn và phí

- `refundAmount = floor(paidAmount × 100 / 100 / 1000) × 1000` (BR-CANCEL-05);
  `netRefund = max(0, refundAmount − refundFee)` (BR-CANCEL-05, BR-CANCEL-11). "Hoàn 100%" của BR-CANCEL-14
  là `refundPercent = 100` trên `refundBase`, **không** phải ngoại lệ trả đúng đồng lẻ hay miễn phí.
- Chỉ BR-CANCEL-13 (bất khả kháng) miễn phí xử lý. Ví dụ: paid 5.001 → gross 5.000; phí 1.000 → net 4.000.
- Muốn trả đúng 5.001 hoặc miễn phí cho walk-out thì phải sửa BR/QĐ, engine và test trước khi payout; không
  dùng số tròn của TC để bỏ biên.

### F6-D03 — Chiết khấu ghép: doanh thu nguyên, phải thu làm tròn **xuống** ở tổng

- `PriceSnapshot` và doanh thu ghi nhận **không đổi**: 1.454.000/bên. `RoomMerge.discountAmount` =
  290.800/bên (20%), 581.600 tổng, ghi riêng là chi phí xử lý quá tải (BR-OVER-15).
- Nghĩa vụ/tiền khách = `floor1000(subtotal − discount)` = `floor1000(1.163.200)` = **1.163.000**, đúng
  BR-RATE-01 bước 11 và `quotePrice` hiện hành (làm tròn **xuống** ở cấp tổng, làm tròn lên chỉ ở cấp đêm).
  `1.163.200` chỉ là số trung gian, không phải phải thu; không làm tròn lên thành 1.164.000.
- Connecting: 6.732.000 − 673.200 = 6.058.800 → **6.058.000**. Chênh 200/800 VND là làm tròn bước 11,
  không cộng vào chi phí quá tải (chi phí báo cáo dùng đúng `discountAmount`).
- HB-125 ghi nghĩa vụ/charges sau khi ghép theo số phải thu này; hoàn tiền vẫn tính trên số đã thu/phân bổ.

### F6-D04 — `approved_by` có điều kiện, không bắt mọi move/merge

- Bắt buộc duyệt khi: (a) `compensationAmount + transportCost > 0` (BR-OVER-06); (b) khách `CHECKED_IN` đi
 ều chuyển do bất khả kháng (BR-OVER-09); (c) `MERGE_SHARE` khác giới/`UNSPECIFIED` (BR-OVER-14);
  (d) khác thành phố (BR-OVER-07).
- Không bắt duyệt: move cùng cơ sở zero-cost chưa check-in (bậc 1–2, `SPLIT_ROOMS`) và `MERGE_SHARE` cùng
  giới đủ hai consent.
- DDL (HB-121): `ck_room_moves_approval` chỉ buộc `approved_by` khi trạng thái `APPROVED`/`EXECUTED` **và**
  `compensation_amount + transport_cost > 0`; `ck_room_merges_consent` chỉ buộc consent cho SHARE (và
  `approved_by` khi ngoại lệ khác giới). Điều kiện trạng thái khách/giới tính do service cưỡng chế và
  HB-124 kiểm; **không** chỉ bỏ CHECK rồi cho mọi execute đi qua (HB-121 AC9).

### F6-D05 — Bàn giao A đỏ: A ở trên nhánh, main chỉ nhận A+B xanh

1. Người làm R2 (Codex) viết **giai đoạn A**: chỉ test khoá + helper trong `allow` của ticket, chạy đỏ vì
   thiếu hành vi (không phải lỗi import/môi trường), lưu log + SHA commit trên `ticket/HB-nnn-*`. Lead
   **không** viết A thay người làm.
2. Lead đọc A, tính `sha256sum` từng tệp và công bố `locked_sha` trong **mọi** ticket khoá tệp đó, trên
   `main`, bằng PR `lead/*` docs. `locked_sha` không nhận glob: mỗi tệp helper cũng phải có dòng riêng.
3. B tạo nhánh từ `main` đã có pin, cherry-pick A (giữ nguyên byte), thêm code; PR cuối chứa A+B và chạy
   full CI xanh; lead merge squash. A đỏ **không** vào `main` một mình.
4. Cấm `skip`/`todo`/nới assertion/đổi CI để merge A đỏ. Log đỏ + SHA của A nằm trong ticket/PR.

Bản đồ pin khi A bàn giao (mỗi tệp ghim ở **tất cả** ticket đang khoá nó):

| Tệp A | Ticket nhận `locked_sha` |
|---|---|
| `apps/api/test/over/{relocation,merge,walkout}.locked.spec.ts` | HB-125, HB-126 |
| `apps/api/test/over/compensation.locked.spec.ts` | HB-125 |
| `apps/api/test/over/helpers/**` | HB-125, HB-126 (từng tệp) |
| `apps/api/test/over/{detection,detection-queries}.locked.spec.ts`, `detection-helpers/**` | HB-126, HB-127 |
| `apps/api/test/ota-inbox/{signature,durability,simulator}.locked.spec.ts` | HB-128 |
| `apps/api/test/channel-sync/{endpoints,inventory}.locked.spec.ts`, `apps/worker/test/channel-sync/{scheduler,failures}.locked.spec.ts` | HB-131 |

Các test miền đã có trên `main` (`planner*.spec.ts`, `merge-policy.spec.ts`, `walkout-policy.spec.ts`) không
cần pin lại trừ khi A/B thật sự sửa nội dung — khi đó phải có quyết định riêng của lead.

### F6-D06 — Chi bồi thường: route riêng, ACCOUNTANT, có chứng từ

- Dùng `POST/GET /room-moves/{roomMoveId}/compensation-payments` (HB-120 AC13). Chỉ `ACCOUNTANT` trong
  scope, có PIN và `Idempotency-Key`; `MANAGER`/`OWNER` chỉ đọc trạng thái/chứng từ, không chi.
- Số tiền lấy từ `RoomMove.compensationAmount` **đã** `MANAGER`/`OWNER` duyệt; client không được khai lại.
- Ghi `Payment.type = 'COMPENSATION'`, `method ∈ {CASH, BANK_TRANSFER}`, kèm `evidenceRefs`/`bankReference`;
  tuyệt đối không dùng `/refund-requests/{id}/pay`, không chi từ quỹ/allocations `REFUND`, không đụng
  `paidAmount` hay Payment gốc (BR-PAY-02, BR-PAY-09).
- HB-121: thêm `payments.room_move_id` (FK, nullable) + unique bảo đảm **một khoản chi** cho một
  `room_move_id` (PENDING/SUCCEEDED); timeout giữ PENDING và tra operation, không tạo lần chi mới.
- Không mở adapter PSP mới: bồi thường là chi tay có bằng chứng; `BANK_TRANSFER` dùng mô hình chứng từ của
  `confirm-transfer`, không tái dùng reservation hoàn tiền.

### F6-D07 — Ranh giới worker/NOTI/F4 và tự đóng ca

- Thông báo điều chuyển/walk-out dùng `NotificationGateway` của API: ghi `PENDING` trong cùng transaction
  rồi `publish` sau commit; worker NOTI hiện có gửi và giữ SLA 15 phút (BR-OVER-10). Không thêm consumer
  mới; khi HB-130 (outbox relay) xong thì thay cơ chế phát, không đổi payload.
- Guard quá tải: HB-122 cung cấp hàm thuần; HB-126 nối vào transaction tạo booking F4 bằng **một lời gọi
  mỏng** sau khi đã khoá tồn, kèm TC-OVER-03/04 thật. Không sửa luật F4 khác; HB-127 sở hữu composition
  worker/build-dist, không kéo API runtime vào worker.
- Tự đóng ca: chỉ khi **còn trước T−24h** (T = 14:00 VN ngày thiếu phòng) và thiếu thực tế = 0. Từ T−24h
  trở đi, ca do người xử lý (kể cả khi thiếu đã về 0); ngày đã qua luôn `ESCALATED`, không tự đóng
  (BR-OVER-16). Actor hệ thống bền: thêm `resolution_source ∈ {USER, SYSTEM}` và cho `resolved_by` NULL
  khi `SYSTEM` (HB-121); không tạo user giả, không gán người xử lý giả.

### F6-D08 — `keepScore`: thứ tự nhánh và điểm

Áp tuần tự, dừng ở nhánh đầu tiên đúng:

1. `paidAmount = 0` → **0** (kể cả `totalAmount`/`depositAmount` = 0).
2. `paidAmount > 0` và `paidAmount ≥ totalAmount` → **20** (bao gồm `totalAmount = 0` mà đã trả dư: không còn nợ).
3. `paidAmount > 0` và (`depositAmount = 0` hoặc `paidAmount ≥ depositAmount`) → **10**.
4. còn lại (`0 < paidAmount < depositAmount`) → **0**.

Ví dụ: tổng 2.000.000/cọc 600.000: trả 0 → 0; trả 300.000 → 0; trả 600.000 → 10; trả 2.000.000 → 20.
Tổng 2.000.000/cọc 0: trả 500.000 → 10. Tổng 0/trả 0 → 0; tổng 0/trả dư > 0 → 20.
BR-OVER-12 (nhóm `WALKIN` chưa trả + `HELD`) lọc **trước**, rồi mới sắp `keepScore` ↑ → `createdAt` ↓ →
`Booking.seq` ↑. Bảng BR §9.3 đã được cập nhật theo quyết định này.

### Trạng thái mở khoá sau quyết định

| Ticket | Điều kiện còn lại |
|---|---|
| HB-120 | Mở ngay (D01, D04, D06 đã chốt); hợp đồng phải theo body connecting/compensation ở trên |
| HB-121 | Mở ngay (D01, D04, D06, D07); DDL/CHECK theo đúng quyết định, không nới vô điều kiện |
| HB-122 | Mở (D08); test keepScore theo bảng nhánh |
| HB-124 | Mở giai đoạn A (D02, D03, D05); A đỏ + SHA, chưa merge |
| HB-125/126/127/128/131 | Chờ A tương ứng + `locked_sha` do lead công bố; sau đó B chạy |
| HB-132…HB-139 | Chờ hợp đồng HB-120 phát hành trên `main` |

## Các sai khác có thể đồng bộ theo nguồn đã ưu tiên

Các điểm sau đã có BR rõ, không cần phát minh luật: scanner mỗi60phút; quota80% **mỗi** OTA không khóa20% cho direct; cam kết OTA đã xác nhận vẫn nhận khi quota hết/đóng bán; missing consent và missing mixed-gender approval là hai mã khác nhau; nhóm HELD/WALKIN chưa trả đứng trước trong danh sách điều chuyển; HMAC cũ quá300s là401, eventID khác hash là409.

Backlog, kế hoạch kiểm thử và dòng replay API đã được đồng bộ trong cùng PR công bố F6. Các nguồn protected cần lead đồng bộ thêm: chuyên đề ghép/tiền/ranh giới đóng ca, UC-CHAN-03 ACK200 booking thay vì202 inbox, FR-CHAN-04 câu oversold vô điều kiện. Các nguồn thiết kế03–04 được người thi công đồng bộ theo QĐ-05 trong PR có phạm vi, không sửa BR theo thiết kế cũ.

## Các quyết định kỹ thuật đã ghi thành đề xuất rõ trong ticket

- API đọc/retry/flag/handoff/booking alerts: HB-120 công bố, HB-125/126/129/131 hiện thực theo scope hiện có, không cấp lễ tân quyền đọc bảng case/rank quản lý.
- sales-closure có `closed` tùy chọn mặc địnhtrue để giữ lệnh đóng hiện tại; mở thủ công chỉ gỡ manual flag, không vượt auto closure/quota. Sync success xác minh phục hồi counter0/OK, giữ lịch sử.
- Schema ordering/account key/reviewflag/closure provenance/version/scan status là gap F6 HB-121; baseline đã có inbox/outbox/delivery và channels.sync_status, không thêm lại hay chờ HB-091 đã đóng.
- Các điểm chung package export/router/worker composition được liệt kê phạm vi và chủ trách nhiệm, rebase giữ phần của ticket khác. Chỉ lead công bố/điền unlock cho protected docs/08; các ticket không tự điền unlock.
