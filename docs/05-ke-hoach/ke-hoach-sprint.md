# 05 — Kế hoạch Sprint chi tiết

> 5 sprint × 2 tuần, mỗi sprint **100 giờ** công sức nhóm. Quy đổi: **1 điểm ≈ 4 giờ** → **25 điểm/sprint**.
> Nguồn chân lý nghiệp vụ: [02/quy-tac-nghiep-vu](../02-nghiep-vu/quy-tac-nghiep-vu.md). Use case: [00 §8](../00-tong-quan.md#8-danh-mục-use-case).

---

## 1. Quy ước

| Ký hiệu | Nghĩa |
|---------|-------|
| `US-<MOD>-<nn>` | Mã user story, dùng trong bảng công việc và commit |
| `SP` | Story point (1 SP ≈ 4 giờ) |
| AC | Tiêu chí chấp nhận, viết ở dạng quan sát được |
| Ưu tiên | **M** bắt buộc · **S** nên có · **C** có thì tốt |

**Định nghĩa Sẵn sàng (DoR):** story chỉ được đưa vào sprint khi có mã US, AC viết xong, BR tham chiếu tồn tại, phụ thuộc đã gỡ, và ước lượng đã chốt.

**Định nghĩa Hoàn thành (DoD):** xem [05/quy-tac-ky-thuat](quy-tac-ky-thuat.md) §6. Tóm tắt: mã đã review + gộp; kiểm thử tự động xanh; AC được chứng minh bằng demo chạy thật; tài liệu và ma trận truy vết đã cập nhật; không có lỗi P0/P1 mới.

---

## 2. Sprint 1 — Nền tảng & tồn phòng (W6–W7, 26/10–08/11/2026)

**Mục tiêu sprint:** *"Dựng được bộ khung chạy được, đăng nhập theo vai trò, và nhìn thấy 55 phòng với ràng buộc chống trùng đã được ép ở tầng CSDL."*

| Mã | User story | SP | Ưu tiên | UC / BR | AC chính |
|----|-----------|----|---------|---------|----------|
| US-INF-01 | Dựng monorepo, CI, Docker, migration từ CSDL trống | 5 | M | — | `docker compose up` dựng Postgres + Redis; `pnpm migrate` chạy sạch trên CSDL trống; CI chạy lint + typecheck + test |
| US-AUTH-01 | Đăng nhập nội bộ, phân quyền theo vai trò và phạm vi cơ sở | 5 | M | UC-AUTH-01/02, BR-RBAC-01/02/06 | 6 vai trò đăng nhập được; `FRONT_DESK` của CS-02 không thấy dữ liệu CS-01; 5 lần sai khoá 15 phút |
| US-PROP-01 | Quản lý cơ sở, loại phòng, phòng vật lý | 5 | M | UC-PROP-01/02/03, BR-PROP-01…06 | Nhập đủ 3 cơ sở / 55 phòng; sức chứa và mã phòng đúng quy ước; không tạo được phòng trùng mã trong một cơ sở |
| US-PROP-02 | Khoá phòng bảo trì / ngừng bán | 3 | M | UC-PROP-04, BR-INV-06 | Khoá một phòng làm tồn khả dụng giảm ngay; chặn khoá đè lên booking đang hoạt động nếu không phải MANAGER |
| US-INV-01 | Lịch tồn phòng dạng lưới theo ngày | 5 | M | UC-INV-01, BR-INV-01/07 | Hiển thị 55 phòng × 30 ngày; cột tồn khả dụng khớp phép tính BR-INV-01; đổi khoảng ngày không cần tải lại trang |
| US-INV-02 | Truy vấn phòng trống cho một kỳ lưu trú | 3 | M | UC-INV-02, BR-INV-07 | Kỳ 5 đêm mà đêm thứ 3 hết phòng → trả về "hết phòng", không trả về phòng |
| US-SYS-01 | Nhật ký kiểm toán nền, append-only | 3 | M | UC-SYS-01, BR-SYS-01/05, BR-GEN-07 | Mọi thay đổi phòng/khoá phòng sinh bản ghi; lệnh `UPDATE`/`DELETE` trên bảng nhật ký bị CSDL từ chối |
| US-INF-02 | Kịch bản chứng minh chống trùng phòng | 2 | M | BR-INV-02/03 | Script bắn 200 yêu cầu giữ cùng một phòng/đêm: đúng 1 thành công, 199 nhận lỗi xung đột; chạy trong CI |
| **Tổng** | | **31** | | | |

> Sprint 1 vượt 25 SP vì gồm công việc nền tảng không lặp lại. Bù bằng cách cắt `US-INV-01` xuống bản tối giản nếu tới hết ngày thứ Tư tuần lẻ chưa xong.

**Kịch bản demo:** Đăng nhập bằng 3 vai trò khác nhau → mở lịch tồn phòng của CS-01 → khoá phòng `CS01-201` → chạy kịch bản 200 yêu cầu đồng thời và cho thấy CSDL từ chối 199.

**Rủi ro trọng yếu:** Prisma không hỗ trợ ràng buộc loại trừ → phải viết migration SQL thủ công (**RSK-04**). Gỡ bằng cách làm ngay ngày đầu sprint 1, không để cuối sprint.

---

## 3. Sprint 2 — Đặt phòng & động giá (W8–W9, 09–22/11/2026)

**Mục tiêu sprint:** *"Chốt được giá đúng cho 7 kênh và tạo được booking từ cả web khách lẫn quầy, có giữ chỗ và hết hạn."*

| Mã | User story | SP | Ưu tiên | UC / BR | AC chính |
|----|-----------|----|---------|---------|----------|
| US-RATE-01 | Động cơ giá thuần trong `packages/domain` | 8 | M | UC-RATE-05, BR-RATE-01…08, 17 | Cho cùng đầu vào, kết quả khớp bảng tính tay cho 24 tổ hợp (3 loại phòng × 4 mùa × 2 kênh); không có I/O; độ phủ nhánh ≥ 90% |
| US-RATE-02 | Cấu hình giá cơ bản, lịch giá, mùa | 5 | M | UC-RATE-01/02, BR-RATE-02…06 | Owner đặt được mùa lễ 30/4 hệ số 1,8 ưu tiên 80; khi hai mùa chồng nhau hệ thống chọn đúng theo quy tắc ưu tiên |
| US-RATE-03 | Cấu hình hệ số và hoa hồng theo kênh | 3 | M | UC-RATE-03, BR-RATE-07/09 | Sửa hệ số kênh có hiệu lực ngay với báo giá mới; báo giá đã chốt không đổi; cảnh báo khi giá thuần OTA thấp hơn WEB |
| US-BOOK-01 | Tạo booking tại quầy (khách vãng lai) | 5 | M | UC-BOOK-02, BR-BOOK-01…10 | Lễ tân tạo booking 2 đêm trong ≤ 5 bước; mã booking đúng định dạng; snapshot giá được lưu |
| US-BOOK-02 | Giữ chỗ có thời hạn và tự động hết hạn | 3 | M | UC-BOOK-04, BR-BOOK-07/08 | Hold web hết hạn sau 20 phút; phòng trở lại tồn khả dụng trong ≤ 60 giây; booking chuyển `EXPIRED` |
| US-BOOK-03 | Tìm phòng và đặt phòng trên web khách | 5 | M | UC-BOOK-01, BR-BOOK-15/16 | Khách chọn ngày → thấy giá từng đêm → đặt → nhận mã; đặt lặp trong 24h trả về booking cũ kèm cờ nghi trùng |
| US-BOOK-04 | Tra cứu và xem chi tiết booking | 2 | S | UC-BOOK-07 | Tra theo mã hoặc số điện thoại; chi tiết hiển thị bảng giá từng đêm |
| US-PROP-03 | Khu back-office: khung điều hướng, bảng dữ liệu, bộ lọc | 3 | M | — | Dùng chung cho các màn sau; phân trang phía máy chủ |
| **Tổng** | | **34** | | | |

> Sprint 2 nặng. Nếu tới hết tuần chẵn `US-RATE-01` chưa xong, chuyển `US-BOOK-03` (web khách) sang Sprint 3 theo thang cắt giảm ở [lo-trinh §7](lo-trinh.md#7-thang-cắt-giảm-phạm-vi-khi-trễ).

**Kịch bản demo:** Chọn CS-01, phòng Deluxe, 3 đêm vắt qua 30/4 → in ra bảng giá từng đêm với các hệ số mùa/cuối tuần/kênh → đặt ở kênh WEB và ở kênh WALKIN, cho thấy chênh 10% → để một hold hết hạn trước mắt người xem.

**Rủi ro trọng yếu:** sai thứ tự áp hệ số (**RSK-02**); lệch giá giữa web và API (**RSK-08**). Gỡ bằng ca kiểm thử đối chiếu ba nền tảng.

---

## 4. Sprint 3 — Huỷ, hoàn cọc & thanh toán (W10–W11, 23/11–06/12/2026)

**Mục tiêu sprint:** *"Huỷ một booking ở bất kỳ mốc nào đều ra đúng số tiền hoàn; tiền về đúng phương thức gốc, có kiểm soát hai cấp."*

| Mã | User story | SP | Ưu tiên | UC / BR | AC chính |
|----|-----------|----|---------|---------|----------|
| US-CANCEL-01 | Động cơ chính sách huỷ thuần trong `packages/domain` | 8 | M | UC-BOOK-08, BR-CANCEL-01…07 | 11 bậc mốc của 4 gói giá là dữ liệu, không phải `if/else`; chọn bậc đúng tại các mốc biên 168h/72h/24h/336h; hoàn tính trên `paidAmount` |
| US-CANCEL-02 | Bảng quyết định và ca kiểm thử hoàn cọc | 5 | M | BR-CANCEL-04…06, 17 | 100% ca trong bảng quyết định đạt; kiểm thử thuộc tính: hoàn không bao giờ vượt số đã trả, và không tăng khi huỷ muộn hơn |
| US-BOOK-05 | Huỷ booking và giải phóng phòng | 3 | M | UC-BOOK-08, BR-BOOK-11/14 | Huỷ trong một transaction: trạng thái đổi, phòng được trả về tồn khả dụng, `RefundRequest` được tạo |
| US-BOOK-06 | Đổi ngày lưu trú | 3 | M | UC-BOOK-06, BR-BOOK-12 | Lần đầu miễn phí khi ≥ 168h; lần hai bị chặn và gợi ý huỷ + đặt mới; `NONREF` thu phí 10% |
| US-PAY-01 | Ghi nhận tiền cọc (tiền mặt / chuyển khoản) | 3 | M | UC-PAY-01, BR-PAY-01/02/06 | Booking chỉ `CONFIRMED` khi đủ cọc; ghi người thu; huỷ cọc không xoá bản ghi |
| US-PAY-02 | Thanh toán trực tuyến qua cổng sandbox | 5 | M | UC-PAY-02, BR-PAY-03/04/05 | Callback trùng khoá không cộng tiền hai lần; quá 15 phút không callback → `FAILED` + giải phóng hold; không lưu dữ liệu thẻ |
| US-PAY-03 | Yêu cầu và duyệt hoàn tiền hai cấp | 5 | M | UC-PAY-04, BR-CANCEL-15/16, BR-PAY-07/08/09 | Người tạo không tự duyệt được; hoàn > 5 triệu cần người duyệt khác và từ MANAGER trở lên; mọi bước ghi nhật ký |
| US-CANCEL-03 | No-show tự động | 2 | S | UC-FO-04, BR-CANCEL-10 | Lúc 23:59 ngày nhận phòng, booking chưa check-in chuyển `NO_SHOW` + áp bậc cuối |
| US-CANCEL-04 | Trả phòng sớm | 2 | S | BR-CANCEL-09 | FLEX7 báo trước ≥ 72h hoàn 50% các đêm còn lại; báo ít hơn → 0% |
| **Tổng** | | **36** | | | |

> Sprint 3 nặng nhất về nghiệp vụ. Cắt trước: `US-CANCEL-04`, rồi `US-CANCEL-03`.

**Kịch bản demo:** Với cùng một booking FLEX7 cọc 30%, cho xem 4 lần huỷ ở 4 mốc khác nhau (200h, 100h, 48h, 10h) ra 4 số tiền hoàn khác nhau đúng bảng; thử tự duyệt yêu cầu của chính mình và bị chặn.

**Rủi ro trọng yếu:** hiểu sai mốc thời gian huỷ (**RSK-01**) và làm tròn tiền (**RSK-02**). Gỡ bằng kiểm thử thuộc tính và ca biên đúng tại 168h00/167h59.

---

## 5. Sprint 4 — Quá tải, ghép & đổi phòng (W12–W13, 07–20/12/2026)

**Mục tiêu sprint:** *"Biến overbooking từ sự cố thành quy trình: phát hiện trước 24 giờ, xử lý theo thang điều chuyển (thứ tự khả dụng 1 → 2 → 4), có ghi vết và bồi thường."*

| Mã | User story | SP | Ưu tiên | UC / BR | AC chính |
|----|-----------|----|---------|---------|----------|
| US-CHAN-01 | Cấu hình kênh, allotment và khoá kênh tự động | 5 | M | UC-CHAN-01, BR-CHAN-01/05/08 | Đặt allotment OTA = 80% phòng; khi tồn ≤ 2 phòng hệ thống tự đóng bán OTA và mở lại khi tồn > 2 |
| US-CHAN-02 | Kênh OTA giả lập: đẩy tồn/giá, nhận booking, nhận huỷ | 8 | M | UC-CHAN-02/03, BR-CHAN-02/03/06/07 | Bắn 20 booking OTA vào bộ mô phỏng: tất cả vào hệ thống trong ≤ 5 phút; một booking vượt tồn tạo `oversold = true` |
| US-OVER-01 | Phát hiện quá tải và mở hồ sơ xử lý | 5 | M | UC-OVER-01, BR-OVER-01…05 | Job quét mỗi giờ, tạo `OverbookingCase` gộp theo (cơ sở, ngày, loại phòng); quá T−24h chưa xử lý → leo thang cho Owner |
| US-OVER-02 | Thang điều chuyển (1 → 2 → 4) và xếp hạng ưu tiên giữ phòng | 8 | M | UC-OVER-02, BR-OVER-06…12 | Với một ca thiếu 2 phòng, hệ thống đề xuất đúng 2 khách có `keepScore` thấp nhất, đúng thứ tự tất định; khách được nâng hạng giữ nguyên giá gốc; bậc 3 hiển thị kèm lý do không khả dụng |
| US-OVER-03 | Ghép phòng cho hai booking | 5 | M | UC-OVER-03, BR-OVER-13…15 | Không ghép được khi thiếu đồng thuận một bên; ghép thành công giảm 20% mỗi bên; chặn ghép khác giới tính nếu không có MANAGER |
| US-OVER-04 | Walk-out và bồi thường | 3 | M | UC-OVER-04, BR-CANCEL-14, BR-OVER-06 | Khi hết phương án, hoàn 100% + bồi thường 1 đêm đầu + chi phí đưa đón có duyệt; khách từ chối phương án điều chuyển được xử lý như walk-out |
| US-CTRL-01 | Bảng điều khiển quá tải cho quản lý | 3 | S | UC-OVER-01 | Thấy danh sách ca quá tải 30 ngày tới, sắp theo hạn xử lý; bấm vào thấy phương án đề xuất |
| **Tổng** | | **37** | | | |

> Cắt trước: `US-CTRL-01`, rồi `MERGE_CONNECTING` trong `US-OVER-03`, rồi `OTA_AIRBNB` trong `US-CHAN-02`.

**Kịch bản demo:** Bơm 60 booking vào CS-01 cho một đêm cao điểm qua bộ mô phỏng OTA → hệ thống mở ca quá tải → chọn "đề xuất phương án" → thực hiện nâng hạng 2 khách và walk-out 1 khách → in biên bản điều chuyển.

**Rủi ro trọng yếu:** chọn sai khách để điều chuyển gây khiếu nại (**RSK-06**); bộ mô phỏng OTA không đủ thật để chứng minh (**RSK-03**).

---

## 6. Sprint 5 — Android, báo cáo, hoàn thiện (W14–W15, 21/12/2026–02/01/2027)

**Mục tiêu sprint:** *"Lễ tân làm được việc trên điện thoại, ban giám đốc tự xem được báo cáo, và hệ thống chịu được tải."*

| Mã | User story | SP | Ưu tiên | UC / BR | AC chính |
|----|-----------|----|---------|---------|----------|
| US-MOB-01 | App Android: đăng nhập, danh sách đến/đi trong ngày | 5 | M | UC-FO-01, BR-RBAC-05 | Cài APK lên máy thật; xem danh sách khách đến hôm nay của đúng cơ sở mình; phiên giữ 7 ngày |
| US-MOB-02 | App Android: check-in và check-out | 5 | M | UC-FO-01/02, BR-FO-01…05 | Check-in bị chặn khi còn nợ tiền; check-out muộn tự tính 50%/100%; nhập PIN 6 số cho thao tác tài chính |
| US-MOB-03 | App Android: tra cứu, đổi phòng, ghi no-show | 5 | M | UC-OVER-02, UC-FO-04 | Đổi phòng bậc 1–2 trong ≤ 30 giây; ghi no-show hỏi xác nhận và hiện số tiền bị tính |
| US-MOB-04 | App Android: cập nhật trạng thái buồng phòng | 3 | S | UC-FO-03, BR-FO-06/07 | Nhân viên buồng phòng đánh dấu dọn xong; phòng chưa dọn không gán được cho khách khác |
| US-REP-01 | Báo cáo công suất, ADR, RevPAR | 5 | M | UC-REP-01 | Chọn khoảng ngày + cơ sở; ADR = doanh thu thuần / số phòng bán; khớp số liệu thử |
| US-REP-02 | Báo cáo doanh thu theo kênh (gộp và thuần sau hoa hồng) | 3 | M | UC-REP-02, BR-RATE-08 | Bảng 7 kênh × doanh thu gộp/thuần/hoa hồng; xuất CSV |
| US-REP-03 | Báo cáo huỷ phòng, hoàn cọc, quá tải | 3 | M | UC-REP-03/04 | Tỷ lệ huỷ theo gói giá; tổng hoàn cọc; số ca quá tải và chi phí xử lý |
| US-NOTI-01 | Thông báo email xác nhận, huỷ, đổi phòng | 3 | S | UC-NOTI-01/02, BR-SYS-06 | Email gửi trong 1 phút; gửi lại tối đa 3 lần; mọi lần gửi có bản ghi |
| US-INF-03 | Kiểm thử tải 200 đồng thời + diễn tập phục hồi sao lưu | 3 | M | NFR-PERF-01, BR-SYS-03 | p95 tra cứu < 800ms ở 200 người dùng đồng thời; phục hồi từ bản sao lưu trong ≤ 4 giờ, có biên bản |
| US-DOC-01 | Báo cáo cuối kỳ, ma trận truy vết, kịch bản demo | 3 | M | — | Ma trận không còn ô trống; README chạy được trên máy sạch |
| **Tổng** | | **38** | | | |

> Đây là sprint cuối; mọi việc chưa xong tới hết ngày thứ Tư tuần cuối **bị cắt**, không dồn. Ưu tiên tuyệt đối: `US-MOB-02`, `US-REP-01`, `US-REP-02`, `US-DOC-01`.

**Kịch bản demo:** Lễ tân check-in một khách trên điện thoại → check-out muộn và hệ thống tính 50% → Owner mở báo cáo doanh thu theo kênh và chỉ ra kênh OTA Booking có doanh thu gộp cao nhất nhưng thuần thấp hơn WEB.

---

## 7. Tổng hợp phân bổ

| Sprint | Tuần | Điểm | Hạng mục chính | Mốc |
|--------|------|------|-----------------|-----|
| 1 | W6–W7 | 31 | Nền tảng, phân quyền, tồn phòng, chống trùng | M4 |
| 2 | W8–W9 | 34 | Động cơ giá, đặt phòng, giữ chỗ, web khách | M5 |
| 3 | W10–W11 | 36 | Chính sách huỷ, thanh toán, hoàn tiền hai cấp | M6 |
| 4 | W12–W13 | 37 | Kênh OTA, quá tải, điều chuyển, ghép phòng | M7 |
| 5 | W14–W15 | 38 | Android, báo cáo, kiểm thử tải, báo cáo cuối kỳ | M8 |
| **Tổng** | | **176** | | |

Ngân sách 750 giờ ≈ 188 điểm; kế hoạch dùng 176 điểm, dự phòng **12 điểm (≈ 6,4%)** cho nợ kỹ thuật và phát sinh. Mức này **thấp hơn** dải 10–15% khuyến nghị, nhóm chấp nhận vì đã có van an toàn thứ hai là thang cắt giảm phạm vi ở [lo-trinh §7](lo-trinh.md#7-thang-cắt-giảm-phạm-vi-khi-trễ).

## 8. Backlog chưa lên lịch

| Mã | Hạng mục | Vì sao hoãn |
|----|----------|-------------|
| US-BL-01 | Ứng dụng iOS | Ngoài phạm vi yêu cầu |
| US-BL-02 | Kênh đại lý có hợp đồng giá riêng theo doanh nghiệp | Chỉ cần mức `AGENCY` đơn giản |
| US-BL-03 | Kế hoạch giá tự động theo dự báo công suất | Vượt phạm vi môn học |
| US-BL-04 | Đa ngôn ngữ (Anh/Việt) cho web khách | Hiện chỉ tiếng Việt |
| US-BL-05 | Thanh toán quốc tế | Không cần cho thị trường mục tiêu |
| US-BL-06 | Hoá đơn điện tử | Q-07 chưa có yêu cầu |
| US-BL-07 | Tự động đối soát hoa hồng OTA theo file kê | Làm tay trong kỳ đầu |
