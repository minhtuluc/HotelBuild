---
id: HB-063
title: SCR-70 gói giá & chính sách huỷ (operations web, API giả) — màn rủi ro cao
risk: R1
owner: deepseek
max_lines: 1000
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-063 — SCR-70 gói giá & chính sách huỷ

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-063 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Chủ chuỗi cấu hình **gói giá** (cọc, số đêm tối thiểu/tối đa, chính sách huỷ áp dụng, trạng thái) và **chính sách huỷ** (toàn bộ các bậc theo mốc giờ + mức hoàn, ngoại lệ trả phòng sớm). Đây là **màn rủi ro cao**: validate theo **từng hàng** phải chặn được bậc sai **trước khi** gửi, và khi máy chủ trả `412`/`428` màn hình phải **giữ nguyên bản nhập** và cho người dùng **đối chiếu khác biệt** thay vì ghi đè.

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-057 (đặc tả do lead viết) + HB-058
- Màn hình: `SCR-70` — căn cứ `UC-RATE-06`; rủi ro cao (điều kiện hoàn tất của backlog: *"Validate theo hàng chặn lưu; 412/428 giữ bản nhập + diff"*)
- Quy tắc nghiệp vụ: BR-CANCEL-01 (bậc là **dữ liệu**, không hard-code), BR-CANCEL-02 (tỷ lệ cọc theo gói, làm tròn **lên**), BR-CANCEL-09 (ngoại lệ trả phòng sớm), BR-RATE-16 (**snapshot bất biến**: sửa gói/chính sách **chỉ** áp cho báo giá mới), BR-RATE-20 (phiên bản/hiệu lực — ADR-015), BR-GEN-03 (làm tròn), BR-GEN-07 (audit)
- Yêu cầu / use case: FR-RATE-19; UC-RATE-06; TC-RATE-27, TC-SYS-11
- API:
  - `GET /api/v1/rate-plans` — **công khai** (api.md §2.4 ghi vai trò "—"; QĐ ở PR #35), chỉ trả điều khoản hiển thị, không lộ cấu hình nội bộ
  - `PUT /api/v1/rate-plans/{ratePlanId}` (OWNER; `depositPercent`, `minNights`, `maxNights`, `cancellationPolicyId`, `status`, `reason`, `If-Match`)
  - `GET /api/v1/cancellation-policies` (OWNER; `status`) — trả **toàn bộ bậc** cùng `version`
  - `PUT /api/v1/cancellation-policies/{policyId}` (OWNER; `tiers[]`, `earlyCheckoutFreeHours`, `earlyCheckoutRefundPct`, `reason`, `If-Match`)
  - Mã lỗi: `E_RATE_CONFIGURATION_INVALID` (bậc trùng mốc / thiếu catch-all / phần trăm sai — **kèm chỉ số bậc lỗi**), `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`
- Backend: HB-057 (AC1–AC5) — thay **toàn bộ** bậc trong một transaction; snapshot cũ không đổi; không có tuyến ghi lên snapshot (§2.14)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/rate-plans` thấy danh sách gói giá kèm cọc, số đêm tối thiểu/tối đa, chính sách áp dụng, trạng thái, phiên bản — test: `rate-plans.spec.ts::hiện danh sách gói giá`
2. Mở chính sách huỷ thấy **toàn bộ bậc** theo thứ tự mốc giờ giảm dần kèm mức hoàn, ngoại lệ trả phòng sớm và phiên bản — test: `rate-plans.spec.ts::hiện toàn bộ bậc chính sách huỷ`
3. **Validate theo hàng chặn lưu**: mốc giờ không tăng dần/trùng nhau, phần trăm ngoài 0–100, thiếu bậc catch-all, số dòng vượt giới hạn hợp đồng → hiện lỗi ở **đúng hàng** và chặn gửi (không gọi API) — test: `rate-plans.spec.ts::validate theo hàng chặn lưu`
4. Lưu chính sách gửi `PUT` kèm **toàn bộ** `tiers[]` (không gửi thiếu hàng), `reason`, `If-Match` = `ETag` đã đọc — test: `rate-plans.spec.ts::lưu gửi toàn bộ bậc`
5. `422 E_RATE_CONFIGURATION_INVALID` có chỉ số bậc lỗi thì tô đúng hàng đó và **giữ nguyên** bản nhập — test: `rate-plans.spec.ts::422 tô đúng hàng lỗi`
6. `412`/`428` thì hiện xung đột phiên bản **kèm bảng khác biệt** giữa bản đang nhập và bản máy chủ trả, **vẫn giữ** bản nhập; chỉ khi người dùng chọn "Dùng bản máy chủ" mới thay — test: `rate-plans.spec.ts::412 giữ bản nhập và hiện diff`
7. Sửa gói giá cũng có `reason` bắt buộc và hiện nhắc **"chỉ áp cho báo giá mới — booking đã chốt giữ snapshot cũ"** (BR-RATE-16/20) — test: `rate-plans.spec.ts::cảnh báo snapshot bất biến`
8. `403` (không phải OWNER) hiện thiếu quyền, không render nút lưu; role `—` của `GET /rate-plans` được xác nhận là công khai (gọi không token vẫn đọc được) — test: `rate-plans.spec.ts::403 và rate-plans công khai`
9. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/rate-plans`)

## Ngoài phạm vi

- Không tính tiền hoàn/tiền cọc ở giao diện: công thức hoàn thuộc engine HB-053 và `/cancel-preview` (F4/F5); màn này chỉ **cấu hình**.
- Không sửa `PriceSnapshot` (BẤT BIẾN — §2.14 có test khẳng định không tồn tại tuyến ghi).
- Không làm mùa/lịch giá (HB-058/059) hay báo giá đa kênh (HB-062).
- Không viết backend HB-057; E2E chạy trên API giả (`page.route`).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- **Bậc là dữ liệu** (BR-CANCEL-01): không hard-code 11 bậc hay mốc 336h/168h/72h/24h ở giao diện; mọi nhãn lấy từ dữ liệu máy chủ. Test phải chạy được với **số bậc khác** (ví dụ 3 bậc) để chứng minh không cứng.
- `hoursBeforeCheckIn` tính theo **giờ VN** và `checkInTime` **của từng cơ sở** (QĐ-05 mục 3) — chỉ hiển thị quy đổi, không tự tính mốc.
- `QĐ-05 mục 1`: hoàn tiền **trước** khi xác nhận là hoàn **đúng số đã thu**, không làm tròn xuống; làm tròn xuống 1.000 chỉ áp cho tiền hoàn theo chính sách của booking **đã** xác nhận — ghi chú này vào màn hình để người cấu hình không hiểu sai.
- Diff khi `412`: chỉ so **các trường người dùng sửa được**; không hiện `beforeJson`/token/PII (AGENTS §3 mục 4).
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
