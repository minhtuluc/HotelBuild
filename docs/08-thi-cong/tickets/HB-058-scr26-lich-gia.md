---
id: HB-058
title: SCR-26 lịch giá & giá cơ bản (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-058 — SCR-26 lịch giá & giá cơ bản

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-058 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản lý cơ sở xem **lịch giá theo ngày** của một loại phòng (giá từng đêm kèm **nguồn** `BASE`/`SEASON`/`OVERRIDE` và mùa đang thắng) và ghi đè giá cho một hoặc nhiều ngày. Thay đổi **lệch quá ±20%** so với giá hiện hành **bắt buộc OWNER xác nhận lại** trong chính yêu cầu gửi đi; giá ngoài `[sàn, trần]` bị máy chủ từ chối.

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-054 (đặc tả do lead viết) + HB-021
- Màn hình: `SCR-26` — căn cứ `UC-RATE-01`, cột dữ liệu *lịch giá & giá cơ bản*
- Quy tắc nghiệp vụ: BR-RATE-02 (`PriceSource`), BR-RATE-03/04 (sàn–trần), BR-RATE-19 (`LONGSTAY14` phải có mức giá riêng), BR-RBAC-04 (lệch > ±20% cần OWNER xác nhận), BR-GEN-01 (tiền VND nguyên)
- Yêu cầu / use case: FR-RATE-01…FR-RATE-06; UC-RATE-01; TC-RATE-03, TC-RATE-04, TC-AUTH-09
- API: `GET /api/v1/room-types/{roomTypeId}/rate-calendar` (MANAGER; `from`, `to`, `source`), `PUT /api/v1/room-types/{roomTypeId}/rate-calendar` (OWNER; `date[]`, `price`, `channelCode`, `priority`, `reason`, `confirmOwnerOverride`, `If-Match`); mã lỗi `E_RATE_CONFIGURATION_INVALID`, `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`
- Backend: HB-054 (AC1–AC2) — `source` và **mùa thắng** lấy từ **cùng hàm phân giải của engine giá** (HB-052); `warnings[]` trả cảnh báo `LONGSTAY14`

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Chọn cơ sở + loại phòng + khoảng ngày rồi mở `/rate-calendar` thì thấy từng ngày kèm giá, **nguồn** (nhãn Việt + mã enum) và mùa đang thắng do máy chủ trả — test: `rate-calendar.spec.ts::hiện lịch giá kèm nguồn và mùa`
2. Giao diện **không** tự suy mùa thắng hay tự tính giá: giá và nguồn hiển thị đúng bằng phản hồi máy chủ (test dùng hai phản hồi khác nhau cho cùng dữ liệu vào để chứng minh không nội suy) — test: `rate-calendar.spec.ts::không tự suy giá ở giao diện`
3. Ô nhập giá ngoài `[sàn, trần]` thì cảnh báo ngay tại ô (giao diện chỉ nhắc; máy chủ vẫn chặn) — test: `rate-calendar.spec.ts::cảnh báo ngoài sàn–trần`
4. Sửa giá **lệch > ±20%** so với giá đang hiển thị thì **bắt buộc** tick "Tôi xác nhận thay đổi lớn" và nhập `reason`; thiếu tick thì chặn tại chỗ, **không** gọi API — test: `rate-calendar.spec.ts::lệch 20% bắt buộc xác nhận`
5. Khi gửi, `confirmOwnerOverride` chỉ được đặt `true` nếu người dùng đã tick; lệch ≤ 20% thì không đặt cờ và (mặc định) không gửi `If-Match` vì lệnh sinh bản ghi mới — test: `rate-calendar.spec.ts::cờ xác nhận đúng theo mức lệch`
6. `422 E_RATE_CONFIGURATION_INVALID` thì hiện lỗi theo trường/ngày và **giữ nguyên** các ô đã nhập — test: `rate-calendar.spec.ts::422 giữ nguyên bản nhập`
7. `warnings[]` của máy chủ (ví dụ `LONGSTAY14` chưa có giá riêng, BR-RATE-19) được hiện nguyên văn trong khu cảnh báo, không bị nuốt — test: `rate-calendar.spec.ts::hiện warnings của máy chủ`
8. `412`/`428` khi ghi thì hiện xung đột + "tải lại và so sánh", không tự ghi đè; `403` khi đọc thì hiện thiếu quyền, không lộ lịch giá — test: `rate-calendar.spec.ts::412 và 403`
9. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical, không cuộn ngang ở 360 px — test: `screens.spec.ts` (thêm `/rate-calendar`)

## Ngoài phạm vi

- Không làm mùa (SCR-27, HB-059) hay gói giá (SCR-70, HB-063) — chỉ liên kết sang.
- Không tự tính giá: mọi con số hiển thị lấy từ `GET rate-calendar` (HB-054 dùng engine HB-052).
- Không sửa giá của booking đã chốt (snapshot bất biến — BR-RATE-16).
- Không viết backend HB-054; E2E chạy trên API giả (`page.route`).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Chênh lệch ±20% tính trên **giá hiện hành của chính ngày đó** (giá máy chủ trả), không tính trên giá cơ bản của loại phòng; ghi rõ công thức trong test.
- Tiền là **số nguyên VND** (BR-GEN-01): dùng `formatMoney` để hiển thị, và `toMoney`-kiểu kiểm tra (số nguyên > 0) trước khi gửi; **không** dùng số thực.
- Ghi nhiều ngày: gửi `date[]` + một `price` theo hợp đồng; nếu người dùng nhập giá khác nhau từng ngày thì gửi nhiều lệnh (mỗi lệnh một khoá idempotency) — nêu rõ trong test.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
