# Rà soát nghiệm thu F0 — yêu cầu sửa trước F1

**Ngày rà soát:** 27/09/2026  
**Kết luận:** **CHƯA NGHIỆM THU F0 — chưa mở F1.** Bỏ qua chênh lệch thời gian/nhân lực theo yêu cầu của chủ dự án; các điểm dưới đây là lỗi hợp đồng, độ tin cậy và tiêu chí bàn giao.  
**Phạm vi:** working tree F0 trong repo OOAD, đối chiếu [lộ trình F0](../05-ke-hoach/lo-trinh-thi-cong-web-android.md), [hợp đồng API](../04-thiet-ke/api.md) và [bằng chứng đội thi công](bang-chung-f0.md). HEAD lúc rà soát: `c9b0c810a02019a98f2e6cb37e858256604c5a61`; thay đổi F0 chưa commit, nên kết quả hiện tại **chưa gắn với một revision bất biến**.

## Việc phải sửa

| Mức | Mã | Phát hiện và vị trí | Yêu cầu sửa / bằng chứng chấp nhận |
|---|---|---|---|
| Chặn | F0-01 | Bộ sinh OpenAPI khai `servers: /api/v1` ở `packages/contracts/src/openapi/generate.ts:22`, trong khi các path ở `packages/contracts/src/openapi/registry.ts` đã bắt đầu bằng `/api/v1` (ví dụ login, dòng 63). Client sinh theo spec sẽ gọi `/api/v1/api/v1/auth/login`. Cùng registry, PIN verify và logout chưa khai bearer security mặc dù là thao tác có xác thực. | Chọn **một** nơi chứa prefix, sinh lại spec, kiểm tra URL thực của ít nhất login/PIN/logout bằng parser hoặc generated client. Khai security đúng theo `api.md` §2.1 và kiểm tra tự động endpoint công khai so với endpoint cần token. |
| Chặn | F0-02 | Schema response dùng `z.strictObject` trong `packages/contracts/src/auth.ts` và `packages/contracts/src/common.ts`; `packages/api-client/src/client.ts:261` biến phản hồi có trường bổ sung thành lỗi `protocol`. Điều này ngược `api.md` §7.1: client phải bỏ qua trường lạ. | Giữ request validation nghiêm ở ranh giới phù hợp, nhưng response decoder phải nhận trường bổ sung mà vẫn kiểm trường bắt buộc/kiểu dữ liệu. Thêm test phản hồi có extra field cho success và error envelope. |
| Chặn | F0-03 | `pnpm products:test:coverage` thất bại: function coverage của `packages/api-client` **71,42%**, dưới ngưỡng **80%**. `pnpm run ci` không gọi coverage. `scripts/check-openapi-drift.mjs` chỉ đối chiếu file sinh với file hiện tại, không so hợp đồng với phiên bản đã phát hành; chưa có cổng `openapi-diff` mà F0 yêu cầu. | Nâng coverage và đưa cổng coverage vào CI; bổ sung kiểm tra breaking change so với bản hợp đồng nền/đã phát hành, có ca kiểm chứng CI đỏ với thay đổi phá vỡ. Duy trì cổng drift hiện có. |
| Chặn | F0-04 | [Lộ trình F0](../05-ke-hoach/lo-trinh-thi-cong-web-android.md) §7.2 yêu cầu 4 app shell có error boundary, trang “không đủ quyền”, và smoke Playwright/Maestro cho cả web/Android. Hiện có fixture forbidden, nhưng không có tuyến access-denied riêng hoặc app error boundary; `bang-chung-f0.md` §2 ghi Maestro 2 app Android **BLOCKED** và native render **NOT_RUN**. Metro/Hermes bundle không chứng minh app render trên thiết bị. | Bổ sung error boundary và màn hình/tuyến thiếu quyền thực sự cho từng shell, kiểm thử điều hướng/lỗi. Chạy tối thiểu một smoke trên **mỗi** app Android bằng emulator/thiết bị, ghi log và ảnh/chứng cứ render 9 trạng thái; nếu môi trường không sẵn có, giữ trạng thái F0 chưa nghiệm thu thay vì tính bundle là smoke. |
| Chặn | F0-05 | Toàn bộ F0 vẫn là thay đổi chưa commit (`git status --short`); [bằng chứng đội thi công](bang-chung-f0.md) cũng tự nhận chưa revision-bound. Không thể xác nhận CI/log tương ứng đúng bản cần bàn giao. | Chốt commit F0, chạy lại cổng CI và smoke trên đúng SHA đó; cập nhật bảng bằng chứng kèm SHA, lệnh, môi trường, kết quả và log/artefact. Không sửa lịch sử bằng chứng cũ thành “đã chạy” nếu chưa chạy lại. |
| Cao | F0-06 | Fallback `defaultId()` ở `packages/api-client/src/client.ts:91–98` dùng `Math.random()` rồi đặt dấu gạch ở vị trí UUID, không bảo đảm UUIDv4 và không dùng nguồn ngẫu nhiên mật mã; `packages/contracts/src/common.ts` yêu cầu UUIDv4. | Dùng nguồn UUIDv4/secure random phù hợp web và React Native hoặc fail rõ ràng khi không có nguồn an toàn. Test nhánh fallback, định dạng version/variant và tính hợp lệ của correlation/idempotency ID. |
| Cao | F0-07 | Timeout trong `packages/api-client/src/client.ts` được huỷ khi `fetch` nhận **headers**, trước khi `response.text()` đọc hết body. Body treo có thể vượt `timeoutMs`. | Áp timeout cho toàn bộ request **và** đọc body; test với phản hồi có headers rồi body không kết thúc, kiểm lỗi timeout và dọn timer/listener. |
| Cao | F0-08 | Các app hiện chưa nhập/khởi tạo `packages/api-client` trong luồng shell; unit fixture của client chưa chứng minh cùng request/response/error đi qua app, như điều kiện F0 §7.2. `packages/ui-native/src/states.tsx` còn hiển thị thời gian UTC thô thay vì định dạng Việt Nam đã thống nhất. | Thêm một smoke tích hợp tối thiểu qua app và client dùng chung (có thể dùng mock server, không cần nghiệp vụ F1). Định dạng thời gian native thống nhất với web và thêm render assertion. |

## Kết quả kiểm tra tại thời điểm rà soát

| Kiểm tra | Kết quả | Ý nghĩa |
|---|---|---|
| `pnpm run ci` | **PASS** cục bộ | Cổng hiện tại xanh nhưng chưa chứa coverage, so sánh breaking change hay smoke Android. |
| `pnpm run check` | **PASS** cục bộ | Kiểm tài liệu/công cụ; không thay thế nghiệm thu sản phẩm. |
| `pnpm test:e2e` | **PASS 26/26** trên Chromium | Chỉ hai web shell. |
| `pnpm products:test:coverage` | **FAIL** (`api-client` functions 71,42% < 80%) | Phải sửa trước khi nghiệm thu. |
| Android Maestro / native render | **BLOCKED / NOT_RUN** theo bằng chứng đội thi công | Chưa có chứng cứ shell chạy trên thiết bị. |
| CI từ xa trên commit F0 | **Chưa có bằng chứng** | Không được suy ra từ kết quả working tree cục bộ. |

Các lỗi `EPERM` khi chạy lần đầu trong sandbox liên quan IPC/local listener của môi trường kiểm thử; các lệnh CI, E2E và coverage ở bảng trên đã được chạy lại ngoài sandbox. Không tính lỗi sandbox là lỗi sản phẩm.

## Điều kiện gửi lại để nghiệm thu

Đội thi công xử lý F0-01 đến F0-08, thêm regression test cho mỗi lỗi kỹ thuật, rồi gửi lại **một commit SHA**, log CI/coverage trên SHA đó, OpenAPI sau sửa và bằng chứng smoke của cả 4 shell. Cập nhật [bằng chứng F0](bang-chung-f0.md) bằng trạng thái thực tế; các mục chưa chạy phải giữ `NOT_RUN`/`BLOCKED`. PM sẽ đối chiếu bản gửi lại với các điều kiện F0 §7.2 trước khi bật F1.
