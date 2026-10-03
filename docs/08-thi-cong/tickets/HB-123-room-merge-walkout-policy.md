---
id: HB-123
title: RoomMergePolicy và WalkOutPolicy thuần, chi phí tách doanh thu
risk: R2
owner: codex
max_lines: 750
allow:
  - packages/domain/src/overbooking/merge/**
  - packages/domain/src/overbooking/walkout/**
  - packages/domain/src/overbooking/index.ts
  - packages/domain/package.json
  - packages/domain/test/overbooking/merge-policy.spec.ts
  - packages/domain/test/overbooking/walkout-policy.spec.ts
locked:
  - packages/domain/test/architecture.spec.ts
  - packages/domain/test/cancellation/**
---

# HB-123 — Policy ghép phòng và walk-out

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Hai policy thuần trả quyết định hợp lệ/từ chối và số tiền nguyên VND dự kiến, không ghi DB/ledger, không gọi PSP, không gửi thông báo, không lấy giờ/ID ngoài tham số. Giữ giá gốc và doanh thu phòng đã bán; biểu diễn riêng chiết khấu ghép, bồi thường và đưa đón để use case ghi chứng từ đúng.

## Phụ thuộc

- HB-003: Money/các giá trị ngày, Clock/ID; HB-053: chính sách huỷ và phép tính hoàn đã chốt (đối chiếu triển khai thực tế trước khi nối).
- HB-122 chỉ khi lấy metadata lựa chọn ứng viên, không trùng trách nhiệm planner.
- HB-120 cho hình thức DTO/mã lỗi; các điểm chờ lead ở ghi chú phải chốt trước khóa test nhạy tiền/tồn.

## Căn cứ

- Pha F6: [backlog](../backlog-f6-f7.md), HB-123.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): §9.2/9.4, BR-OVER-08/13…15, BR-CANCEL-04/05/11/14…17, BR-PAY-02/07…09, BR-REP-01.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §8–9, ví dụ discount 581.600 và walk-out cọc 1.320.000.
- [API](../../04-thiet-ke/api.md): §2.8/3.10/4.1, `room-merges`, `room-moves`; `E_OVER_NO_CONSENT`, `E_OVER_MERGE_GENDER`, `E_BOOK_OVER_CAPACITY`.
- [CSDL](../../04-thiet-ke/csdl.md): §3.2.5–3.2.6; [kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-07/11…14.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. MERGE_SHARE chỉ cho `allowShared=true`, `bedCount>1`, ngày trùng nhau, tổng khách ≤ sức chứa, mỗi booking có đơn vị giường riêng; không ghép hai booking vào một giường — test: `packages/domain/test/overbooking/merge-policy.spec.ts::HB123_share_inventory_and_capacity`.
2. Thiếu consent một bên trả `E_OVER_NO_CONSENT`; đọc giới tính từ Guest đứng tên, đủ consent nhưng khác giới hoặc UNSPECIFIED và chưa có MANAGER+ duyệt kèm lý do trả `E_OVER_MERGE_GENDER`; đủ ngoại lệ mới hợp lệ — test: `packages/domain/test/overbooking/merge-policy.spec.ts::TC_OVER_11_13_consent_gender_error_boundary`.
3. MERGE_CONNECTING yêu cầu liên kết phòng hai chiều và đủ sức chứa; chiết khấu 10% tổng giá hai phòng, MERGE_SHARE 20% từng bên; SPLIT_ROOMS giữ snapshot/đơn giá không chiết khấu — test: `packages/domain/test/overbooking/merge-policy.spec.ts::TC_OVER_12_connecting_and_split_rules`.
4. Hai khoản doanh thu phòng 900.000 giữ tổng 1.800.000 sau ghép, discountAmount=360.000 là chi phí riêng; không giảm doanh thu hoặc PriceSnapshot gốc để ghi chiết khấu — test: `packages/domain/test/overbooking/merge-policy.spec.ts::TC_OVER_14_revenue_unchanged_discount_cost`.
5. Ví dụ hai booking 1.454.000 cho discount 290.800/bên, discountAmount tổng 581.600; PriceSnapshot/doanh thu vẫn 1.454.000 mỗi booking. Không lấy 1.163.000 trong ví dụ chuyên đề làm số phải thu mới: 1.454.000−290.800=1.163.200 và BR-GEN-03 không cho làm tròn giá xuống. Cách áp khoản giảm vào nghĩa vụ/hoàn sau ghép phải theo quyết định tiền đã chốt — test: `packages/domain/test/overbooking/merge-policy.spec.ts::HB123_discount_and_rounding_example`.
6. Walk-out hoặc khách từ chối điều chuyển trả dự kiến hoàn 100% cơ sở hợp lệ và bồi thường đúng giá đêm đầu **PriceSnapshot gốc**; ca paid=2.000.000/đêm đầu=1.100.000 trả hai khoản riêng; chưa trả có hoàn 0 — test: `packages/domain/test/overbooking/walkout-policy.spec.ts::TC_OVER_07_refund_and_compensation_separate`.
7. Không coi tiền hoàn là chi phí quá tải; `cost=discount+compensation+transport`, bồi thường không cộng refundedAmount/khấu trừ quỹ hoàn; paidAmount gốc không giảm khi hoàn — test: `packages/domain/test/overbooking/walkout-policy.spec.ts::HB123_accounting_classifications`.
8. Walk-out trả yêu cầu chứng từ `walkOutDocNo`, `guestSignatureRef`, `staffSignatureRef`, cần MANAGER+ duyệt chi; policy trả metadata, không giả chữ ký/PSP/thu chi thành công — test: `packages/domain/test/overbooking/walkout-policy.spec.ts::HB123_walkout_documents_and_approval_requirements`.
9. Trên dữ liệu đã chốt, Money và clock/ID qua input cho đầu ra lặp lại như nhau; không mutate snapshot/assignment và không có I/O — test: `packages/domain/test/overbooking/walkout-policy.spec.ts::HB123_pure_deterministic_policies`.

## Ngoài phạm vi

- Workflow maker–checker/quỹ hoàn/chi PSP do PAY thực hiện; policy không tự duyệt hoặc payout.
- Execute/rollback và lưu consent do HB-124/HB-125; UI và báo cáo do ticket riêng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · test policy miền, ngưỡng nhánh ≥90%; `npm run check` nếu sửa tài liệu. Chốt các điểm dưới đây bằng lead trước khi giao test nhạy tiền cho HB-124.

## Ghi chú cho người làm — điểm phải chốt

- BR-OVER-13/14 chỉ bắt hai consent với MERGE_SHARE và duyệt khi khác giới; API §3.10/DDL hiện bắt consent + approvedBy cho mọi ghép. Tài liệu quá tải §8.1 nói MERGE_CONNECTING cùng một booking không cần hai consent, nhưng DDL bắt hai booking khác nhau. Làm theo BR, báo lead để chỉnh thiết kế/đường nối; không tự nới constraint và không hứa AC connecting runtime trước quyết định.
- Ví dụ chuyên đề §8.3/§10.3 ghi giá sau ghép 1.163.000 và “tính lại giá” cần lead đồng bộ với BR-GEN-03/BR-OVER-15 trước khi khoá AC tiền; discount 290.800 mỗi bên là số riêng, không tự sửa PriceSnapshot.
- BR-CANCEL-14 “hoàn 100%” phải đối chiếu BR-CANCEL-05 làm tròn xuống 1.000 và BR-CANCEL-11 phí cấu hình. Công thức overdoc `floor(paid/1000)*1000 = paid` sai nếu tiền thực trả không chia hết 1.000. Không tự miễn phí walk-out, không bỏ làm tròn hoặc hứa netRefund=paid cho mọi đầu vào; ghi nhánh nonmultiple/fee>0 là chờ lead chốt, chặn chi trên nhánh chưa rõ.
- Cơ sở hoàn phải theo số tiền đủ điều kiện và phân bổ đã xử lý, không `paidAmount-refundedAmount` một cách giản lược khi có quỹ giữ hoặc khoản thu muộn (BR-CANCEL-04/17). Tiền vận chuyển bậc 3 có trần, bậc 4 tự nguyện theo mức MANAGER duyệt; không áp trần sai cho ngoại lệ khác thành phố.
