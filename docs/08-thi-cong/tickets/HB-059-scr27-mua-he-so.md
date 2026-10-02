---
id: HB-059
title: SCR-27 mùa & hệ số (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 800
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - tests/e2e/**
locked:
unlock:
---

# HB-059 — SCR-27 mùa & hệ số

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-059 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Chủ chuỗi/quản lý cấu hình **mùa** cho một cơ sở: tên, khoảng ngày, hệ số, thứ tự ưu tiên, phụ thu cuối tuần; và **thấy rõ mùa nào thắng** khi các mùa chồng nhau, kèm lý do. Mùa chồng nhau **được phép** (BR-RATE-05) — việc chọn mùa thắng là của máy chủ (cùng hàm phân giải với engine giá), giao diện **không** tự chọn.

## Căn cứ

- Pha: F3 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.5; ticket phụ thuộc HB-054 + HB-058 (đặc tả do lead viết)
- Màn hình: `SCR-27` — căn cứ `UC-RATE-02`, cột dữ liệu *mùa & hệ số*
- Quy tắc nghiệp vụ: BR-RATE-05 (chọn mùa khi nhiều mùa cùng khớp — §4 tài liệu nghiệp vụ), BR-RATE-06 (phụ thu cuối tuần), BR-RBAC-04
- Yêu cầu / use case: FR-RATE-03; UC-RATE-02; TC-RATE-03
- API: `POST /api/v1/seasons` (OWNER; `propertyId`, `name`, `startDate`, `endDate`, `multiplier`, `priority`, `weekendSurchargeEnabled`); mã lỗi `E_RATE_CONFIGURATION_INVALID`, `E_GEN_VALIDATION_FAILED`, `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`
- Backend: HB-054 AC3 (mùa chồng được phép; test chọn đúng mùa thắng) và AC1 (lịch giá trả mùa thắng) — màn SCR-26 dùng lại chính dữ liệu đó

## Khoảng trống hợp đồng (cần lead chốt)

api.md §2.4 chỉ có **`POST /seasons`** — không có tuyến **đọc** danh sách mùa và không có tuyến **sửa** mùa. Hệ quả cho SCR-27:
- không liệt kê được mùa hiện có của cơ sở;
- không hiện được "mùa thắng + lý do" một cách trực tiếp (phải mượn `GET rate-calendar`);
- sửa `priority`/`multiplier`/khoảng ngày của mùa đã tạo là **không thể** (chỉ tạo mới).

**Đề xuất (QĐ-04 mục 7):** bổ sung `GET /api/v1/seasons?propertyId&from&to` (MANAGER, trả `id`, `name`, `startDate`, `endDate`, `multiplier`, `priority`, `weekendSurchargeEnabled`, `version`, `ETag`) và `PATCH /api/v1/seasons/{seasonId}` (OWNER, `If-Match`, `reason`) — đối xứng với cách `PATCH /channels/{channelId}` đã làm. Chờ lead chốt trước khi viết mã; nếu chưa chốt thì ticket chỉ làm được phần **tạo mùa**, phần danh sách/mùa thắng phải ghi `BLOCKED`.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Mở `/seasons` thì thấy danh sách mùa của cơ sở kèm hệ số, ưu tiên, phụ thu cuối tuần và phiên bản — test: `seasons.spec.ts::hiện danh sách mùa`
2. Form tạo mùa kiểm khoảng ngày (`endDate ≥ startDate`), hệ số theo hợp đồng, tên bắt buộc; sai thì chặn tại chỗ, không gọi API — test: `seasons.spec.ts::form sai thì không gọi API`
3. Tạo mùa chồng khoảng với mùa đã có thì **cho phép** nhưng hiện cảnh báo "chồng lấn — máy chủ quyết định mùa thắng" (không chặn) — test: `seasons.spec.ts::chồng lấn được phép kèm cảnh báo`
4. Sau khi tạo, màn hình **đọc lại** và hiển thị; mùa thắng cho từng ngày lấy từ dữ liệu máy chủ trả (`GET rate-calendar`), giao diện không tự so `priority` để chọn — test: `seasons.spec.ts::mùa thắng lấy từ máy chủ`
5. `403` (không phải OWNER khi ghi / ngoài phạm vi cơ sở khi đọc) thì hiện thiếu quyền, không lộ danh sách — test: `seasons.spec.ts::403 hiện thiếu quyền`
6. Mất mạng khi tạo là "chưa xác định kết quả" kèm mã tra cứu, không báo thất bại chắc chắn — test: `seasons.spec.ts::mất mạng là chưa xác định kết quả`
7. Mọi trạng thái §8.1 hiện đúng, không có vi phạm axe serious/critical — test: `screens.spec.ts` (thêm `/seasons`)

## Ngoài phạm vi

- Không ghi đè giá theo mùa (SCR-26, HB-058) và không cấu hình hệ số kênh (SCR-28, HB-060).
- Không tự nhân giá với hệ số ở giao diện: mọi con số giá lấy từ `/rate-calendar` (engine HB-052).
- Không hỗ trợ xoá mùa (hợp đồng không có tuyến xoá; hết hiệu lực bằng khoảng ngày).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e`

## Ghi chú cho người làm

- Hệ số gửi nguyên giá trị máy chủ chấp nhận (hợp đồng `rate.ts` quy định khoảng, ví dụ 0,1–5); hiển thị bằng `formatMultiplier` (hai chữ số thập phân, dấu phẩy) — đã có trong `@pinehill/ui-web`.
- Nếu lead **chưa** bổ sung `GET /seasons`: làm phần tạo mùa + cảnh báo chồng lấn trên dữ liệu `rate-calendar`, và ghi `BLOCKED` cho tiêu chí 1/4 kèm lý do trong PR — không bịa danh sách mùa.
- Địa chỉ API truyền từ server component + `dynamic = 'force-dynamic'`; tái dùng bộ dùng chung của HB-037.
