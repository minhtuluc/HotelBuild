---
id: HB-037
title: SCR-19 cơ sở + SCR-20 loại phòng/sức chứa/sàn–trần (operations web, API giả)
risk: R1
owner: deepseek
max_lines: 900
allow:
  - apps/operations-web/src/**
  - apps/operations-web/test/**
  - packages/contracts/src/property.ts
  - packages/contracts/src/openapi/paths/f2.ts
  - packages/contracts/openapi.json
  - packages/contracts/test/**
  - packages/api-client/src/f2.ts
  - packages/api-client/test/**
  - tests/e2e/**
  - docs/04-thiet-ke/api.md
  - docs/05-ke-hoach/lo-trinh-thi-cong-web-android.md
locked:
unlock:
---

# HB-037 — SCR-19 cơ sở + SCR-20 loại phòng/sức chứa/sàn–trần

> Đặc tả tự soạn (QĐ-04 mục 6) từ dòng HB-037 của [backlog F2–F3](../backlog-f2-f3.md); lead duyệt cùng PR.

## Mục tiêu

Quản trị chuỗi mở được hai màn hình nền của F2 trên operations web: **SCR-19** xem/sửa cơ sở (giờ nhận–trả phòng, trần bán vượt, ngừng bán) và **SCR-20** xem danh sách loại phòng kèm sức chứa cùng sàn–trần giá, tạo loại phòng mới. Backend HB-033 chưa có nên màn hình chạy trên **API giả** dựng bằng `page.route` của Playwright; hợp đồng và client gọi đúng như khi có backend thật.

## Căn cứ

- Pha: F2 — [lộ trình](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.4 (màn SCR-19, SCR-20)
- Quy tắc nghiệp vụ: BR-PROP-01 (mỗi cơ sở có mã phòng duy nhất, không trùng), BR-PROP-03 (tổng đơn vị bán toàn chuỗi 75), BR-PROP-04 (sàn ≤ giá cơ bản ≤ trần), BR-OVER-01/02 (trần bán vượt theo cơ sở), BR-GEN-04 (giờ nhận/trả), BR-RATE-03/04 (sàn/trần), BR-RBAC-01/02 (quyền theo vai trò × phạm vi)
- Use case / yêu cầu: UC-PROP-01, UC-PROP-02; FR-PROP-01…FR-PROP-04
- API: `GET /api/v1/properties`, `PATCH /api/v1/properties/{propertyId}`, `GET /api/v1/room-types` (**bổ sung** — xem ghi chú), `POST /api/v1/room-types`; mã lỗi `E_RBAC_FORBIDDEN`, `E_AUTH_OUT_OF_SCOPE`, `E_GEN_VERSION_CONFLICT`, `E_GEN_PRECONDITION_REQUIRED`, `E_RATE_CONFIGURATION_INVALID`, `E_GEN_VALIDATION_FAILED`
- Màn hình: `SCR-19`, `SCR-20` ([thiết kế màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) §bảng SCR)

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Cho danh sách cơ sở từ API, khi mở `/properties` thì thấy tên, trạng thái, số phòng ACTIVE, trần bán vượt, giờ nhận/trả, phiên bản — test: `tests/e2e/operations-web/properties.spec.ts::hiện danh sách cơ sở`
2. Sửa cơ sở gửi `PATCH` kèm `If-Match` bằng phiên bản đang hiển thị (dạng `"3"` theo api.md §1.3), `Idempotency-Key` và `reason`; server trả 200 thì hiện băng xác nhận kèm phiên bản mới và danh sách giữ nguyên — test: `properties.spec.ts::lưu cơ sở gửi If-Match, lý do và hiện phiên bản mới`
3. Không nhập `reason` thì chặn tại chỗ bằng trạng thái `validationError` (`reason: REQUIRED`), không gọi API — test: `properties.spec.ts::thiếu lý do thì không gọi API`
4. Server trả `412 E_GEN_VERSION_CONFLICT` thì hiện trạng thái xung đột kèm hai phiên bản và nút tải lại, không tự ghi đè — test: `properties.spec.ts::412 hiện xung đột`
5. Server trả `403 E_AUTH_OUT_OF_SCOPE` thì hiện trạng thái thiếu quyền, không lộ dữ liệu — test: `properties.spec.ts::403 hiện thiếu quyền`
6. Mất mạng khi ghi thì hiện "chưa xác định kết quả" kèm mã tra cứu, **không** báo thất bại chắc chắn — test: `properties.spec.ts::mất mạng khi ghi là chưa xác định kết quả`
7. Cho danh sách loại phòng từ API, khi mở `/room-types` thì thấy mã, sức chứa người lớn/trẻ em, giá cơ bản, sàn, trần và cảnh báo khi sàn > trần hoặc giá cơ bản ngoài [sàn, trần] — test: `tests/e2e/operations-web/room-types.spec.ts::hiện sàn–trần và cảnh báo`
8. Tạo loại phòng gửi `POST` đủ trường bắt buộc; server trả `422 E_RATE_CONFIGURATION_INVALID` thì hiện lỗi theo trường, giữ nguyên bản nhập — test: `room-types.spec.ts::422 giữ nguyên bản nhập`
9. Mọi màn hình trên phủ đủ 9 trạng thái của hợp đồng §8.1 và không có vi phạm axe mức serious/critical — test: `tests/e2e/operations-web/screens.spec.ts`
10. Hàm thuần ánh xạ lỗi → trạng thái màn hình đúng theo mã và theo lớp HTTP (412/428 → conflict, 422 → validationError, 403 → forbidden, mạng/timeout khi ghi → unknownOutcome, mạng khi đọc → alert) — test: `apps/operations-web/test/screen-state.spec.ts`

## Ngoài phạm vi

- Không làm SCR-21/22 (buồng, khoá phòng), lưới tồn, allotment, kiểm toán, tham số — các ticket HB-038…HB-044.
- Không làm backend thật (HB-033) và không làm BFF (HB-019): E2E dùng `page.route`.
- Không sửa quy tắc giá/phân quyền trong frontend; màn hình chỉ hiển thị và gửi yêu cầu.
- Không xử lý xoá cơ sở/loại phòng (hợp đồng không có tuyến xoá).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:e2e` (mở thật hai màn hình) · `npm run check:docs` (đụng `docs/04`, `docs/05`)

## Ghi chú cho người làm

- **Bổ sung hợp đồng `GET /api/v1/room-types`** (QĐ-04 mục 7): api.md §2.2 chỉ có `POST /room-types`, không có tuyến đọc nào trả sức chứa/sàn–trần, nên SCR-20 không liệt kê được. Đây là bổ sung **tương thích** (không phá vỡ baseline 1.0.0): vai trò HOUSEKEEPING như `GET /rooms`, query `propertyId?`. Đã cập nhật api.md §2.2 và lộ trình §7.4 trong cùng PR.
- Quyền: `GET` cho HOUSEKEEPING, `PATCH /properties/{id}` và `POST /room-types` cho OWNER. Màn hình ẩn nút ghi khi không phải OWNER nhưng **quyết định quyền vẫn ở server** — UI chỉ phản ánh `403`.
- Trần/sàn: kiểm tra hiển thị ở UI là **cảnh báo**, không phải nguồn chân lý; server vẫn là nơi chặn (BR-RATE-03/04).
- Bám mẫu F0: `(ops)/states/page.tsx` cho 9 trạng thái, `(ops)/api-probe.tsx` cho cách gọi client và ánh xạ lỗi.
- **Bẫy đã gặp (chạy thật mới lộ):** biến `NEXT_PUBLIC_*` được Next.js nhúng vào bundle **lúc build**, nên nếu client tự đọc `webEnv()` thì khi chạy thật (`next start` với biến khác) client nhận `undefined` và mọi lời gọi API hỏng ngay (triệu chứng: băng "Không gọi được API: UNKNOWN", không có request nào ra mạng). Vì vậy địa chỉ API **truyền từ server component** (`webEnv().NEXT_PUBLIC_API_BASE_URL`) xuống màn hình, như `api-probe` của F0; hai tuyến khai `dynamic = 'force-dynamic'`.
- Sau khi ghi thành công, màn hình **giữ dữ liệu** và hiện băng `role="status"`; trạng thái `success` đầy đủ của §8.1 vẫn phủ qua `?state=success` (giống bộ khung F0).
