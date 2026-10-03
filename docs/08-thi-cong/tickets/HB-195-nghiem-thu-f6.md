---
id: HB-195
title: Hồ sơ nghiệm thu F6 và mốc M7 cho lead
risk: R0
owner: opus
max_lines: 350
allow:
  - docs/07-ban-giao/bang-chung-f6-nghiem-thu.md
---

# HB-195 — Hồ sơ nghiệm thu F6 và mốc M7 cho lead

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Lead đọc bằng chứng HB-194 và các ticket F6, lập hồ sơ quyết định nghiệm thu mốc M7. Bản đặc tả này cho phép viết hồ sơ bằng chứng/đánh giá; không có quyền tự cập nhật file protected hoặc tự đánh dấu mốc hoàn tất.

## Căn cứ

- [lộ trình F6 §7.8](../../05-ke-hoach/lo-trinh-thi-cong-web-android.md#78-f6--kênh-quá-tải-điều-chuyển-ghép-phòng-walk-out), [mốc M7](../../05-ke-hoach/lo-trinh.md), [lộ trình đến deploy](../lo-trinh-den-deploy.md).
- [BR nguồn chân lý](../../02-nghiep-vu/quy-tac-nghiep-vu.md), [quá tải/ghép/đổi phòng](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md); [API §6.3](../../04-thiet-ke/api.md#63-tập-permission-và-projection-bắt-buộc).
- [kiểm thử TC-CHAN/TC-OVER](../../05-ke-hoach/ke-hoach-kiem-thu.md); [màn hình](../../04-thiet-ke/thiet-ke-man-hinh.md) SCR-40…47/63/67.
## Phụ thuộc

- HB-194 có bằng chứng trên SHA được nộp; HB-120…139 đã có implementation/bằng chứng tương ứng; HB-097/099/100 bảo đảm pipeline ngoại lệ/hoàn/chi; HB-014/015/029 bảo đảm permission/PIN/retry. Hồ sơ đánh giá dùng bằng chứng thật, không suy việc xong từ đặc tả đã tồn tại.

## Phạm vi hồ sơ

Chỉ `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md`; không viết code hoặc sửa test. Hồ sơ có bảng ticket/PR/SHA/kết quả/gaps, matrix TC/AC→artefact HB194, capability browser/device/backend, quyết định nguồn, P0/P1, nợ/chuyển pha có owner/hạn và kết luận lead (chưa ký/không đạt/đạt). Giữ báo cáo QA HB194 làm nguồn bằng chứng, hồ sơ này dẫn chiếu và quyết định, không ghi đè log QA.

Tiền/quyền/trạng thái lấy bằng chứng backend. Tập quyền độc lập API §6.3 phải có kiểm chứng read/write/approve/execute/payout và scope; không dùng nhãn MANAGER+ để tự cấp tất cả quyền. Không ghi secrets/PIN/token/PII khách thật hoặc URL tệp ký vào hồ sơ.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một kiểm chứng nghiệm thu tương lai)

1. Hồ sơ truy vết đủ HB120…139, HB194 và TC-CHAN01…11/TC-OVER01…18; ghi đúng commit, PR/CI, browser versions, build/device, lệnh và artefact; không chấp nhận PASS của SHA khác hay UI giả thay API thật. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_exact_sha_complete_evidence`.
2. Phát hiện quá tải trước T−24h trên dữ liệu mô phỏng, grouped cases đúng, ca mới sau hạn leo thang ngay; ca qua ngày ESCALATED không tự đóng, mốc/người/lý do giữ được. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_M7_detection_escalation`.
3. Bảng keepScore đầy đủ và nhóm ưu tiên cứng hiện trước confirm, thứ tự tất định backend; thang chuẩn 1→2→4, lý do bậc3 160–300km; giữ giá gốc; CHECKED_IN chỉ bất khả kháng có duyệt. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_M7_score_ladder_price_lock`.
4. Đồng thuận hai bên/giới tính/version/tồn kiểm lại lúc execute; thất bại giữ nguồn/case mở; chiết khấu ghi riêng không đổi doanh thu; walk-out hoàn/bồi thường/chứng từ/duyệt/chi với principal đúng quyền, retry không tạo lần hai. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_atomic_consent_money_permissions`.
5. Đồng bộ/outbox không mất hoặc nhân đôi, simulator nhận ≤5 phút, DEGRADED sau3 lỗi và retry202→terminal; OTA cam kết confirmed được nhận dù quota/tồn0, huỷ theo policy OTA, suspectedDuplicate không sửa tiền. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_channel_delivery_intake`.
6. Chromium+WebKit/a11y trên SCR40…47 và Android Hermes/Maestro/SCR63/67 có log thật; APK cài/mở trên máy thật; từng bậc1–2 ≤30 giây/≤6 chạm, count cả bước PIN phát sinh, offline không báo thành công; chưa có máy thật thì BLOCKED M7. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_M7_browser_android_real_device`.
7. Mâu thuẫn nguồn có quyết định minh thị: nhịp quét BR mỗi giờ, quota từng kênh, TCCHAN10/OVER13 kỳ vọng cũ, mô hình connecting và DDL duyệt cùng giới; unresolved semantics tiền/tồn/quyền ghi BLOCKED, không tự đổi BR hoặc bỏ ca để ký. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_source_decisions`.
8. Không còn P0/P1 mở; ticket chưa merge/chuyển pha ghi lý do/owner/hạn và quyết định lead rõ; capability thiếu là BLOCKED với ảnh hưởng nghiệm thu, không dùng danh sách nợ để che yêu cầu bắt buộc chưa chứng minh. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_release_readiness_decision`.
9. Hồ sơ ghi kết luận và người/giờ quyết định; mọi cập nhật backlog/mốc protected chỉ sau lead chấp thuận unlock cụ thể, không coi owner opus hoặc allow hồ sơ là quyền sửa protected. — kiểm chứng hồ sơ: `docs/07-ban-giao/bang-chung-f6-nghiem-thu.md::ACCEPT_F6_protected_update_authorization`.

## File protected và điều kiện cập nhật mốc

`docs/08-thi-cong/**` được PROTECTED bởi `scripts/lib/scope.mjs`; nguồn `docs/01`, `docs/02`, `docs/00` cũng protected. `allow` của HB195 không chứa backlog/lộ trình, frontmatter không điền unlock. Muốn cập nhật `docs/08-thi-cong/backlog-f6-f7.md`, `docs/08-thi-cong/lo-trinh-den-deploy.md` hay file protected khác, lead phải phê duyệt minh thị danh sách đường dẫn và tự điền unlock trong ticket/quy trình được phép trước thao tác. Hồ sơ ghi rõ yêu cầu cập nhật dự kiến và trạng thái chờ duyệt; bản nháp không sửa các file đó. Mốc trong tài liệu kế hoạch cũng cần lead xác nhận trạng thái và phạm vi sửa, không tự tuyên bố đạt chỉ vì bảng đặc tả đã đủ.

## Ngoài phạm vi

Không sửa BR/FR, endpoint/schema/UI/test/locked, không nới ngưỡng timing/chạm/a11y hoặc tự miễn PIN/consent; không thay bằng chứng bằng cam kết; không tự merge/push/main hoặc giả chữ ký lead.

## Cổng phải xanh và ghi chú

`npm run check` và `pnpm check:scope` cho PR hồ sơ; dẫn link `pnpm run ci`, contract/scope/backend và browser/device evidence trên đúng SHA từ HB194. Kiểm chứng hồ sơ là review có tên ở file bằng chứng, không phải test automation đã hiện thực. Thiếu bước ghi BLOCKED + ticket/người gỡ; chỉ lead ký khi điều kiện đủ. Bản đặc tả là tài liệu chuẩn bị, chưa xác nhận F6/M7 hoàn tất.
