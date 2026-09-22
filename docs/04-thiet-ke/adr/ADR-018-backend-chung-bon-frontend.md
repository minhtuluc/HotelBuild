# ADR-018 — Một backend chung, bốn frontend deploy độc lập

**Trạng thái:** Đã chấp nhận · **Ngày:** 22/09/2026 · **Liên quan:** NFR-MAIN-04, NFR-USE-01, ADR-005, ADR-006, [kien-truc.md §5–§7](../kien-truc.md)

## Bối cảnh

Pine Hill có hai nhóm người dùng với mục tiêu và nhịp phát hành khác nhau: khách đặt phòng và đội vận hành tại cơ sở. Mỗi nhóm cần một web app và một Android app riêng. Tuy nhiên, tiền, tồn phòng, phân quyền, policy, idempotency và audit phải có một nguồn sự thật; tách backend theo frontend sẽ nhân đôi transaction và tạo rủi ro lệch nghiệp vụ.

## Quyết định

- Dùng một backend modular monolith trong `apps/api` và một worker dùng chung trong `apps/worker`.
- Dựng bốn frontend deploy độc lập: `apps/customer-web`, `apps/customer-android`, `apps/operations-web`, `apps/operations-android`.
- Bốn frontend chỉ truy cập `/api/v1` qua `packages/api-client`, dùng DTO/schema từ `packages/contracts`; không truy cập CSDL, Redis hay adapter PSP/OTA.
- `packages/domain` là nguồn thực thi authoritative cho nghiệp vụ ở API/worker. Frontend chỉ hiển thị `PriceQuote`, policy snapshot và quyền do backend trả về; không sao chép luật giá, hoàn tiền hoặc phân quyền.
- `packages/ui-web` và `packages/ui-native` chia sẻ token/primitive phù hợp nền tảng, không ép web và native dùng chung component.
- Mỗi frontend có pipeline, application ID/hosting target, biến môi trường và release gate riêng; tất cả đều bị chặn nếu contract version hoặc compatibility window không đạt.

## Phương án đã cân nhắc

| Phương án | Ưu điểm | Nhược điểm | Kết luận |
|---|---|---|---|
| Một backend + bốn frontend | Một nguồn sự thật cho transaction; release UI độc lập; phân quyền rõ theo surface | Tốn thêm cấu hình build và test matrix | **Chọn** |
| Một web + một mobile chứa cả khách và vận hành | Ít project hơn | Blast radius lớn, navigation/auth dễ lẫn, khó phát hành và phân quyền theo nhóm | Loại |
| Backend riêng cho khách và vận hành | Tách scale/release mạnh | Nhân đôi tồn, tiền, policy, audit; khó giữ bất biến liên giao diện | Loại |

## Hệ quả

- Tích cực: backend giữ locality cho invariant tài chính/tồn; bốn frontend có seam API rõ và có thể thay adapter UI mà không đổi miền.
- Tích cực: test E2E chia thành customer web, operations web, customer Android, operations Android; lỗi một surface không che lấp kiểm thử surface khác.
- Tích cực: có thể phát hành operations hotfix mà không bắt khách nâng cấp app, miễn API giữ compatibility window.
- Tiêu cực: CI phải chạy build/typecheck và contract smoke test cho bốn app; EAS cần hai application ID.
- Tiêu cực: không được coi package UI là nơi chứa nghiệp vụ; mọi shortcut đưa logic giá/policy vào client là vi phạm ADR này.

## Cổng nghiệm thu khi thi công

1. Không có import Prisma/Redis/adapter từ bất kỳ frontend nào.
2. Mọi frontend gọi qua `packages/api-client`; contract test chứng minh cùng request/response/error.
3. `TC-RATE-21` chạy với API + bốn frontend và đối chiếu `PriceSnapshot`.
4. Release checklist ghi rõ app nào đã build, contract version nào, và compatibility window nào đang hỗ trợ.
