# Nợ kỹ thuật

Theo [QĐ-04](../05-ke-hoach/nhat-ky/QD-04-quan-tri-tu-chu.md) mục 7: những gì chưa làm kịp mà **không** chạm tiền, tồn, phân quyền, bảo mật thì ghi vào đây thay vì dừng việc. Người làm thêm dòng trong PR của mình; lead xếp ưu tiên. Mục nào thuộc [cổng go-live](../08-thi-cong/lo-trinh-den-deploy.md#4-cổng-go-live) phải trả trước go-live.

| Mã | Mô tả | Ghi bởi (ticket/PR) | Ảnh hưởng | Trả trước | Trạng thái |
|---|---|---|---|---|---|
| TD-01 | Worker cần listener `error` cho BullMQ và log lỗi Redis có cấu trúc | HB-006 (#12), phần log lỗi HB-078 | Khó chẩn đoán sự cố | Ticket worker nghiệp vụ đầu tiên (HB-078) | Đã trả: Worker/Queue log queue/component/mã lỗi an toàn; kiểm ngắt và phục hồi Redis thật. Luồng expiry HB-078 còn chờ HB-076 |
| TD-02 | Smoke 2 app Android trên thiết bị/emulator chưa chạy | F0, HB-022, HB-024 | Chưa có bằng chứng chạy trên máy thật | Go-live (cổng 13) | Mở |
| TD-03 | Phân mảnh `audit_logs` theo tháng chưa làm | csdl §8.1 | Hiệu năng khi > 20 triệu dòng | Khi chạm ngưỡng | Mở |

## Nhóm chờ đợt rà soát hợp đồng F2/F3 (từ đặc tả màn hình HB-037…HB-063)

Người lập: DeepSeek, khi tự soạn đặc tả 14 ticket màn hình F2/F3 (PR #39, #41…#53). Mỗi mục là một **tuyến API còn thiếu** khiến màn hình tương ứng không làm được đủ theo dòng backlog; các đặc tả đã ghi rõ phần nào ghi `BLOCKED` nếu chưa bổ sung. Đề xuất xử lý **gộp một đợt** vì cùng đụng `docs/04-thiet-ke/api.md` và `packages/contracts`.

| Mã | Mô tả | Ghi bởi (ticket/PR) | Ảnh hưởng | Trả trước | Trạng thái |
|---|---|---|---|---|---|
| TD-04 | Thiếu tuyến đọc khoá phòng: api.md §2.2 chỉ có `POST /room-blocks` và `DELETE /room-blocks/{id}` | HB-039 (#42) | SCR-22 không liệt kê được khoá hiện có ⇒ không tính được **cảnh báo chồng lấn** (tiêu chí chính của dòng backlog) | Đợt rà soát F2/F3 | Mở |
| TD-05 | Thiếu tuyến đọc tham số hệ thống: §2.13 chỉ có `PUT /system-settings/{key}` | HB-044 (#47) | SCR-17 không biết giá trị hiện tại, `value_type` hay phiên bản (`ETag`) để hiển thị và gửi `If-Match` | Đợt rà soát F2/F3 | Mở |
| TD-06 | Thiếu tuyến đọc/sửa mùa: §2.4 chỉ có `POST /seasons` | HB-059 (#49) | SCR-27 không liệt kê được mùa hiện có, không sửa được `priority`/`multiplier`/khoảng ngày; "mùa thắng" phải mượn `GET rate-calendar` | Đợt rà soát F2/F3 | Mở |
| TD-07 | Thiếu tuyến liệt kê kênh: §2.4 chỉ có các tuyến theo `{channelId}` | HB-042 (#44), HB-060 (#50) | SCR-25 và SCR-28 không dựng được ô chọn kênh; một tuyến dùng chung cho cả hai màn | Đợt rà soát F2/F3 | Mở |
| TD-08 | Thiếu tuyến đọc/sửa khuyến mãi: §2.4 chỉ có `POST /promotions` | HB-061 (#51) | SCR-29 không liệt kê được khuyến mãi, không thấy `usedCount`, không tắt sớm được | Đợt rà soát F2/F3 | Mở |
| TD-09 | Không có endpoint "bảng điều khiển ngày": không tuyến nào trả đến/đi/ở trong ngày, ca quá tải, kênh `DEGRADED`; `GET /bookings/{bookingId}` ghi rõ **"không cấp HOUSEKEEPING"** trong khi SCR-23 thuộc `ACT-02/03/04` | HB-040 (#45) | SCR-23 chỉ làm được phần tồn khả dụng + mốc "cập nhật lúc … giờ VN"; phần F4 (đến/đi/ở, ca quá tải) chưa có nguồn dữ liệu | Đợt rà soát F2/F3 (đề xuất `GET /operations/day-board` kèm phân quyền) | Mở |
| TD-10 | Thiếu nguồn `If-Match` cho `PUT /channel-allotments`: hợp đồng không có trường `version` cho từng dòng allotment | HB-042 (#44) | SCR-25 phải mượn `ETag` của `GET /channel-allotments`; nếu server không trả `ETag` thì lệnh ghi thiếu điều kiện ⇒ 428 im lặng | Đợt rà soát F2/F3 | Mở |
| TD-11 | Thiếu số **đơn vị bán theo loại phòng**: `roomTypeSummarySchema` không trả trường này (BR-PROP-03 bán theo đơn vị, DOR bán theo giường) | HB-042 (#44) | SCR-25 không cảnh báo được "vượt đơn vị bán `ACTIVE`" (BR-INV-05) mà không bịa số | Đợt rà soát F2/F3 | Mở |

**Đề xuất xử lý gộp** (một PR hợp đồng, tương thích ngược — không phá vỡ baseline 1.0.0):

1. `GET /api/v1/room-blocks` — HOUSEKEEPING, query `propertyId?`, `roomId?`, `from?`, `to?` (TD-04).
2. `GET /api/v1/system-settings` (+`/{key}`) — OWNER, kèm `valueType`, `version` và `ETag` (TD-05).
3. `GET /api/v1/seasons` — MANAGER, kèm `version`/`ETag`; `PATCH /api/v1/seasons/{seasonId}` — OWNER, `If-Match`, `reason` (TD-06).
4. `GET /api/v1/channels` (+`/{channelId}`) — MANAGER, kèm `ETag`; dùng chung cho SCR-25 và SCR-28 (TD-07).
5. `GET /api/v1/promotions` — MANAGER, kèm `usedCount`, `version`; `PATCH /api/v1/promotions/{promotionId}` — OWNER, `If-Match`, `reason` (TD-08).
6. `GET /api/v1/operations/day-board` — bảng điều khiển ngày (F4): `arrivals[]`, `departures[]`, `inHouse[]`, `availability[]`, `overbookingCases[]`, `degradedChannels[]` (TD-09).
7. `PUT /channel-allotments`: trả `ETag` (hoặc thêm `version` cho từng dòng allotment) (TD-10).
8. `GET /room-types`: bổ sung số đơn vị bán của loại phòng (TD-11).

Riêng `GET /room-types` (HB-037/PR #39) và `GET /room-blocks` (HB-039/PR #42) đã có đề xuất tương tự trong đặc tả; nếu đợt rà soát chốt thì cập nhật `docs/04-thiet-ke/api.md` + `packages/contracts` trong cùng PR đó.

## Nhóm rà soát kiến trúc giữa kỳ — mốc 47% (12/10/2026)

Chi tiết báo cáo rà soát kiến trúc độc lập: xem [ra-soat-kien-truc-giua-ky.md](ra-soat-kien-truc-giua-ky.md).

| Mã | Mô tả | Ghi bởi | Ảnh hưởng | Trả trước | Trạng thái |
|---|---|---|---|---|---|
| TD-12 | Migration sau baseline thiếu tự động áp dụng khối `REVOKE` cho bảng mới (`0004_allotment_scopes`) | Rà soát kiến trúc giữa kỳ | Bảng append-only/tiền mới có thể bị cấp nhầm quyền `UPDATE/DELETE` | Trước đợt migration bảng tiền kế tiếp (HB-091/F5) | Mở |
| TD-13 | Tài liệu kiến trúc lệch mã nguồn: `kien-truc.md §1` ghi idempotency ở Redis (thực tế code dùng PostgreSQL), `§7` ghi 1 image (thực tế 2 Dockerfile) | Rà soát kiến trúc giữa kỳ | Lệch giữa tài liệu thiết kế và mã triển khai thực tế | Đợt rà soát bàn giao HB-192 | Mở |
| TD-14 | Quyết định kết nối CSDL cho tiến trình `apps/worker` (dùng chung Prisma Client hay tách riêng) | Rà soát kiến trúc giữa kỳ | Cần chốt trước khi viết handler CSDL cho worker HB-078 và HB-130 | Khi Codex nhận HB-078 | **Đóng** (17/10/2026): nền worker đã có Prisma qua `apps/worker/src/jobs/context.ts::createJobRuntime` — một `PrismaClient` dùng chung cho mọi handler; HB-130/HB-163/HB-168 chạy trên nền đó |
| TD-15 | Cập nhật đóng các nợ kỹ thuật TD-04, TD-05, TD-09, TD-10 đã được hiện thực hóa qua `HB-035`, `HB-036`, `HB-040` | Rà soát kiến trúc giữa kỳ | Sổ nợ kỹ thuật chưa phản ánh việc đã có endpoint thật trong mã | Nghiệm thu F2 (HB-049) | Mở |
| TD-16 | Ca tích hợp tự khai trần **15 giây** cho tiến trình con nhưng trần vitest chỉ **5 giây** ⇒ đỏ oan dưới tải (đỏ thật ở `customer-web/session/journey-routes`, `operations-web/room-block-routes/routes`, `worker/outbox-relay/lease`) | Người thay vai lead (bằng chứng khi chạy cổng mẻ F3–F4) | Cổng CI đỏ ngẫu nhiên, mất lượt chạy lại | Trước khi chạy tải/CI nightly | Đang xử lý: **HB-200** sửa 3 ca nặng, **HB-202** sửa 7 ca cùng kiểu; nhánh lead `lead/ci-flake-tc-rate-22` xử lý `TC-RATE-22` |
| TD-17 | `IdempotencyStore` dùng `maxWait`/pool mặc định: dưới tải cao (200 request song song, `connection_limit=50`) hàng đợi kết nối vượt `maxWait=1000` ⇒ nhiều lệnh trả **500 `E_GEN_SERVICE_UNAVAILABLE` trước khi use case chạy** (nhánh dọn claim cần thêm một kết nối) | Người thay vai lead (đo trong ca tải AC4 của HB-076) | Lệnh ghi trả 500 không do nghiệp vụ dưới tải; client phải thử lại bằng khoá mới | Trước UAT/tải (HB-184) | Mở — đề nghị xem lại `maxWait`/pool của idempotency store hoặc giảm tải ghi đồng thời |


