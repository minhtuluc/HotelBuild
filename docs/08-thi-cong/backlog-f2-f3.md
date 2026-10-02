# Backlog F2–F3 — cấu hình nền, tồn phòng, giá, chính sách huỷ

Mục lục và quy ước: [backlog](backlog.md) · lộ trình: [đến deploy](lo-trinh-den-deploy.md). Dòng trong bảng **chưa phải đặc tả**; lead (hoặc người thay vai lead theo [sổ tay](so-tay-lead.md)) viết file `tickets/HB-nnn-*.md` trước khi giao. Mã căn cứ đã kiểm có trong tài liệu khi lập (02/10/2026).

**Phân công đặc tả (02/10/2026):** DeepSeek tự soạn và làm màn hình HB-037…HB-044, HB-058…HB-063; lead viết mọi ticket còn lại của F2/F3 (đã có file). Hợp đồng bổ sung: `GET /room-types` do HB-037 thêm; `PATCH /room-types/{id}`, `POST /rooms`, `PATCH /rooms/{id}` do HB-033 thêm. Loader dữ kiện tồn (`modules/inv/facts`, HB-034) và dữ kiện giá (`modules/rate/pricing-facts`, HB-056) dùng lại ở F4.

Quy tắc chung cho mọi ticket migration của các pha (HB-031, HB-051, HB-071, HB-091, HB-121): **kiểm csdl §3 trước**. Baseline 0001 đã dựng đủ 42 bảng; nếu §3 đã có bảng/cột cần thiết thì đóng ticket với ghi chú "không cần migration".

## F2 — cấu hình nền & tồn phòng (operations web, SCR-16…25)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| [HB-030](tickets/HB-030-hop-dong-f2.md) | Hợp đồng F2: PROP (`GET /properties`, `PATCH /properties/{id}`, `POST /room-types`, `GET /rooms`, `PUT /rooms/{roomId}/connecting-room`, `POST/DELETE /room-blocks`), INV (`GET /inventory/grid`, `GET/PUT /channel-allotments`), SYS (`GET /audit-logs`, `PUT /system-settings/{key}`, `POST /system/backups`, `/system/backups/{id}/restore`, `GET /operations/{operationId}`) + mã lỗi `E_INV_NO_AVAILABILITY`, `E_INV_LOCK_TIMEOUT` + client + thông điệp UI — **xong** | R2 | DeepSeek | HB-011 | api.md §2.1, §2.14; FR-PROP-01…07, FR-INV-01, FR-INV-06, FR-INV-07, FR-SYS-01…03; UC-PROP-01…04, UC-INV-01, UC-INV-03, UC-SYS-01…03 | `check:openapi` xanh, `check:contract` 0 phá vỡ; client gọi đủ endpoint; mã lỗi có thông điệp |
| HB-031 | Migration tiến F2 nếu §3 thiếu (allotment, `SystemSetting`, theo dõi operation) — **đóng 02/10: không cần migration** (csdl §3 đủ cột, mọi bảng có `updated_at` cho If-Match) | R2 | — | HB-005, HB-030 | csdl §3; QĐ-02 mục 3; BR-INV-05, BR-SYS-02, BR-SYS-03 | Migrate CSDL trống xanh; schema khớp §3 |
| [HB-032](tickets/HB-032-engine-ton.md) | **Engine tồn khả dụng** thuần (`packages/domain`): hai tầng BR-INV-01, demand mọi kênh + hold còn hạn + cam kết chưa gán, hết nếu một đêm hết. Dùng chung cho F4 — **xong** | R2 | Codex | HB-003 | BR-INV-01, BR-INV-02, BR-INV-07, BR-PROP-06; ADR-014; UC-INV-02; TC-INV-01…11 | 0 I/O; kỳ 5 đêm đêm 3 hết → hết phòng; block hai lần chỉ loại một đơn vị; nhánh ≥ 90% |
| [HB-033](tickets/HB-033-uc-co-so-phong.md) | UC + endpoint cơ sở/loại phòng/phòng/phòng thông nhau | R1 | DeepSeek | HB-030, HB-031, HB-014, HB-009 | FR-PROP-01…05; UC-PROP-01…03; BR-PROP-01, BR-PROP-03, BR-PROP-04, BR-PROP-05 | Không trùng mã phòng trong cơ sở; chỉ OWNER sửa; audit cùng transaction |
| [HB-034](tickets/HB-034-uc-khoa-phong.md) | UC + endpoint khoá phòng: tồn giảm ngay; khoá đè booking cần MANAGER+ và mở `OverbookingCase` | R2 | Codex | HB-032, HB-033 | FR-INV-07; UC-PROP-04; BR-INV-06, BR-PROP-06; TC-PROP-04 | `FRONT_DESK` khoá đè bị từ chối; MANAGER khoá kèm lý do → mở case |
| [HB-035](tickets/HB-035-uc-luoi-ton-allotment.md) | UC + endpoint lưới tồn & allotment (payload gọn, batch nguyên tử) | R1 | DeepSeek | HB-032, HB-033 | FR-INV-01, FR-INV-06; UC-INV-01, UC-INV-03; BR-INV-01, BR-INV-05, BR-INV-07; NFR-PERF-05 | Lưới 55 × 30; cột tồn khớp BR-INV-01; `PUT allotment` một transaction |
| [HB-036](tickets/HB-036-uc-nhat-ky-tham-so.md) | UC + endpoint SYS: `audit-logs` chỉ đọc, `system-settings/{key}` (audit cùng transaction, If-Match), `operations/{operationId}`. Sao lưu/phục hồi làm ở HB-179 | R1 | DeepSeek | HB-030, HB-009, HB-014 | FR-SYS-01, FR-SYS-02; UC-SYS-01, UC-SYS-02; BR-SYS-02, BR-SYS-05, BR-GEN-07; ADR-017; TC-SYS-01, TC-SYS-03, TC-SYS-11 | Không có tuyến ghi `audit-logs`; đổi tham số có audit cùng transaction; 412/428 theo version |
| HB-037 | SCR-19 cơ sở + SCR-20 loại phòng/sức chứa/sàn–trần | R1 | DeepSeek | HB-033, HB-021 | SCR-19, SCR-20; UC-PROP-01, UC-PROP-02; BR-PROP-01, BR-PROP-03 | 9 trạng thái; axe 0 serious/critical; E2E |
| HB-038 | SCR-21 sơ đồ buồng & phòng vật lý + phòng thông nhau | R1 | DeepSeek | HB-037 | SCR-21; UC-PROP-03; BR-PROP-05, BR-OVER-15 | Gán phòng thông nhau đối xứng; 9 trạng thái |
| HB-039 | SCR-22 khoá phòng bảo trì/ngừng bán | R1 | DeepSeek | HB-034, HB-037 | SCR-22; UC-PROP-04; BR-INV-06; TC-PROP-04 | Cảnh báo chồng lấn; khoá đè cần MANAGER + lý do |
| HB-040 | SCR-23 bảng điều khiển ngày | R1 | DeepSeek | HB-035, HB-020 | SCR-23; UC-INV-01; BR-INV-01 | Đến/đi/ở, tồn khả dụng; mốc "cập nhật lúc … giờ VN" |
| HB-041 | SCR-24 lưới tồn phòng theo ngày (màn rủi ro cao) | R1 | DeepSeek | HB-035, HB-040 | SCR-24; UC-INV-01; BR-INV-01, BR-INV-07; NFR-PERF-05; TC-SYS-10 | Đổi khoảng ngày không tải lại; ≤ 200 KB gzip; `role="grid"`, điều hướng phím, ký hiệu chữ kèm màu |
| HB-042 | SCR-25 allotment theo kênh | R1 | DeepSeek | HB-035, HB-041 | SCR-25; UC-INV-03; BR-INV-05, BR-CHAN-01 | Cảnh báo vượt phòng ACTIVE; xử lý xung đột version |
| HB-043 | SCR-16 nhật ký kiểm toán (chỉ đọc, lọc, xuất CSV) | R1 | DeepSeek | HB-036 | SCR-16; UC-SYS-01; BR-SYS-01, BR-SYS-05; TC-SYS-01 | Không có thao tác sửa/xoá trên giao diện |
| HB-044 | SCR-17 tham số hệ thống | R1 | DeepSeek | HB-036, HB-043 | SCR-17; UC-SYS-02; BR-SYS-02 | Chỉ OWNER; có lý do + lịch sử |
| [HB-045](tickets/HB-045-scr18-sao-luu.md) | SCR-18 sao lưu & phục hồi + theo dõi `operationId` — **làm cùng F9** | R1 | DeepSeek | HB-179 | SCR-18; UC-SYS-03; BR-SYS-03 | Trạng thái `PENDING/RUNNING/SUCCEEDED/FAILED`; tải biên bản |
| HB-046, HB-047 | Dự phòng tách ticket (SCR-24, SCR-20) | — | lead cấp | — | — | — |
| [HB-048](tickets/HB-048-qa-f2.md) | QA F2 trên API thật, Chromium + WebKit, axe | R0 | Gemini | HB-037…HB-044 | TC-PROP-01…04, TC-INV-01…11, TC-SYS-10 | Log PASS/NEEDS_CHANGES; axe sạch; TC-SYS-10 trên SCR-24 |
| [HB-049](tickets/HB-049-nghiem-thu-f2.md) | Nghiệm thu F2 | — | lead | HB-048 | lộ trình §7.4 | Bằng chứng SHA/ngày/lệnh/kết quả |

## F3 — giá, mùa, kênh, gói giá & chính sách huỷ (operations web, SCR-26…30, 70)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| [HB-050](tickets/HB-050-hop-dong-f3.md) | Hợp đồng F3: `rate-calendar`, `seasons`, `channels/{id}`, `promotions`, `quotes/multi-channel`, `rate-plans`, `cancellation-policies/{policyId}` + mã `E_RATE_CONFIGURATION_INVALID`, `E_RATE_BELOW_FLOOR`, `E_RATE_PROMO_INVALID`, `E_RATE_QUOTE_MISMATCH` + client. **Chủ duy nhất** của hợp đồng `rate-plans` — **xong** | R2 | DeepSeek | HB-011 | api.md §2.1, §2.14; FR-RATE-01…13, FR-RATE-17, FR-RATE-19; UC-RATE-01…06 | 0 phá vỡ; không có tuyến ghi lên price snapshot |
| HB-051 | Migration tiến F3 nếu §3 thiếu (version policy/rate plan) — **đóng 02/10: không cần migration** (snapshot policy ở `price_snapshots.policy_snapshot_json`) | R2 | — | HB-005, HB-050 | csdl §3; BR-RATE-16, BR-RATE-20, BR-CANCEL-01, BR-CANCEL-02 | Migrate trống xanh; schema khớp §3 |
| [HB-052](tickets/HB-052-engine-gia.md) | **Engine giá** thuần (US-RATE-01): pipeline 11 bước thứ tự cố định, `engineVersion`, 0 I/O. Dùng chung cho F4 — **xong** | R2 | Codex | HB-003 | [động giá](../02-nghiep-vu/dong-gia.md) §2; BR-RATE-01, BR-RATE-03…10, BR-RATE-17, BR-RATE-18; UC-RATE-05; TC-RATE-01…12, TC-RATE-22 | 24 tổ hợp khớp bảng tính tay; mọi tiền là số nguyên VND; nhánh ≥ 90% |
| [HB-053](tickets/HB-053-engine-huy.md) | **Engine chính sách huỷ** thuần (US-CANCEL-01): 11 bậc là dữ liệu, biên 336h/168h/72h/24h, hoàn trên `paidAmount`, phân bổ huỷ một phần. Dùng chung cho F5 — **xong** | R2 | Codex | HB-003 | [chính sách huỷ](../02-nghiep-vu/chinh-sach-huy-hoan-coc.md) §2–§5; BR-CANCEL-01, BR-CANCEL-03…07, BR-CANCEL-19; UC-BOOK-08; TC-CANCEL-44 | 100% bảng quyết định; đúng bậc tại 168h00/167h59; hoàn ≤ `paidAmount`, không tăng khi huỷ muộn hơn |
| [HB-054](tickets/HB-054-uc-lich-gia-mua.md) | UC + endpoint lịch giá & mùa: mùa chồng theo ưu tiên, xác nhận ±20% | R1 | DeepSeek | HB-050, HB-051, HB-052, HB-014, HB-009 | FR-RATE-01…06; UC-RATE-01, UC-RATE-02; BR-RATE-05, BR-RATE-19, BR-RBAC-04; TC-RATE-03, TC-RATE-04, TC-AUTH-09 | Mùa chồng chọn đúng; +25% buộc OWNER xác nhận |
| [HB-055](tickets/HB-055-uc-kenh-khuyen-mai.md) | UC + endpoint kênh & khuyến mãi: hệ số/hoa hồng + override theo cơ sở, sàn `1/(1−hoa hồng)` | R1 | DeepSeek | HB-050, HB-052, HB-014 | FR-RATE-07…13; UC-RATE-03, UC-RATE-04; BR-RATE-07, BR-RATE-09, BR-RATE-10, BR-RATE-18; TC-RATE-10 | Báo giá đã chốt không đổi khi sửa hệ số; khuyến mãi chạm sàn → `E_RATE_BELOW_FLOOR` |
| [HB-056](tickets/HB-056-uc-bao-gia-da-kenh.md) | UC + endpoint báo giá đa kênh (7 kênh, gộp/thuần, cảnh báo OTA < WEB) | R1 | DeepSeek | HB-052, HB-054, HB-055 | FR-RATE-17; UC-RATE-05; BR-RATE-07, BR-RATE-08, BR-RATE-17 | Sai 1 VND so với engine là lỗi |
| [HB-057](tickets/HB-057-uc-goi-gia-chinh-sach.md) | UC + endpoint gói giá & chính sách huỷ: validate bậc, version/If-Match, snapshot bất biến | R2 | Codex | HB-050, HB-053, HB-014, HB-009 | FR-RATE-19; UC-RATE-06; BR-CANCEL-01, BR-CANCEL-02, BR-RATE-16, BR-RATE-20; ADR-015; TC-RATE-27, TC-SYS-11 | Bậc trùng/thiếu catch-all → `E_RATE_CONFIGURATION_INVALID`; snapshot cũ không đổi |
| HB-058 | SCR-26 lịch giá & giá cơ bản | R1 | DeepSeek | HB-054, HB-021 | SCR-26; UC-RATE-01; BR-RATE-19, BR-RBAC-04; TC-AUTH-09 | Xác nhận lệch ±20% |
| HB-059 | SCR-27 mùa & hệ số | R1 | DeepSeek | HB-054, HB-058 | SCR-27; UC-RATE-02; BR-RATE-05 | Hiện mùa thắng + lý do khi chồng |
| HB-060 | SCR-28 kênh: hệ số & hoa hồng | R1 | DeepSeek | HB-055, HB-058 | SCR-28; UC-RATE-03; BR-RATE-07, BR-RATE-09 | Cảnh báo dưới sàn |
| HB-061 | SCR-29 khuyến mãi | R1 | DeepSeek | HB-055, HB-058 | SCR-29; UC-RATE-04; BR-RATE-10 | Validate đủ trường |
| HB-062 | SCR-30 xem trước báo giá đa kênh | R1 | DeepSeek | HB-056, HB-058 | SCR-30; UC-RATE-05; BR-RATE-17 | Chỉ hiển thị số backend trả |
| HB-063 | SCR-70 gói giá & chính sách huỷ (màn rủi ro cao) | R1 | DeepSeek | HB-057, HB-058 | SCR-70; UC-RATE-06; BR-CANCEL-01, BR-RATE-20; TC-RATE-27, TC-SYS-11 | Validate theo hàng chặn lưu; 412/428 giữ bản nhập + diff |
| HB-064…HB-066 | Dự phòng tách ticket | — | lead cấp | — | — | — |
| [HB-067](tickets/HB-067-qa-f3.md) | QA F3 trên API thật, đối chiếu giá web ↔ API | R0 | Gemini | HB-058…HB-063 | TC-RATE-21, TC-SYS-11 | Giá web khớp API; axe sạch |
| [HB-068](tickets/HB-068-doi-chieu-f2-f3.md) | Đối chiếu tài liệu ↔ mã F2 + F3; i18n, tiền VND | R0 | Gemini | HB-048, HB-067 | NFR-LOC-01…03 | 0 chuỗi cứng; tiền số nguyên |
| [HB-069](tickets/HB-069-nghiem-thu-f3.md) | Nghiệm thu F3 | — | lead | HB-067, HB-068 | lộ trình §7.5 | Bằng chứng đủ |

## Khoảng trống tài liệu (xử lý khi viết đặc tả)

1. Thứ tự SCR của F2 khác nhau giữa lộ trình §7.1, §7.4 và §8 (cùng 10 màn) — dùng §8.
2. OPEN-03 (phiên bản/hiệu lực policy và rate plan) còn mở — chặn DoR HB-057/HB-063. Mặc định: có `version`, booking đọc snapshot bất biến, sửa chỉ áp báo giá mới, OWNER duyệt (ADR-015).
3. Q-08 (giờ nhận phòng) ảnh hưởng `hoursBeforeCheckIn` của HB-053. Mặc định: `checkInTime` của từng cơ sở, tính theo giờ VN.
4. `GET /inventory/grid` chỉ đọc, không giữ khoá; khoá bi quan chỉ ở luồng giữ chỗ F4.
