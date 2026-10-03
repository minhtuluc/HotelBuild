---
id: HB-124
title: Khóa bộ test điều chuyển, ghép phòng và walk-out trước giao HB-125
risk: R2
owner: codex
max_lines: 1000
allow:
  - apps/api/test/over/relocation.locked.spec.ts
  - apps/api/test/over/merge.locked.spec.ts
  - apps/api/test/over/walkout.locked.spec.ts
  - apps/api/test/over/compensation.locked.spec.ts
  - apps/api/test/over/helpers/**
locked:
  - packages/domain/test/overbooking/planner.spec.ts
  - packages/domain/test/overbooking/planner-properties.spec.ts
  - packages/domain/test/overbooking/merge-policy.spec.ts
  - packages/domain/test/overbooking/walkout-policy.spec.ts
---

# HB-124 — Test khóa use case OVER

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

Codex thiết kế bộ test khóa có Oracle nghiệp vụ độc lập và kiểm DB thật cho điểm rủi ro tiền/tồn/quyền. Chạy đỏ vì thiếu hành vi ứng dụng trước khi giao HB-125; ghi test tên gì, lỗi gì, commit nào. Không sửa production để làm xanh tại ticket này. Các file `.locked.spec.ts` mới do HB-124 viết được khóa trong `locked` của HB-125 sau bàn giao.

## Phụ thuộc

- HB-121 schema audit/migration tiến cho gap thực, HB-122 planner, HB-123 merge/walk-out policy; blocker nối connecting/phí walk-out được lead giải quyết trước ca nhạy tiền.
- HB-007 DB/UnitOfWork, HB-008 Redis/cache, HB-009 audit/clock/ID, HB-076 giao dịch khoá tồn, HB-014 RBAC, HB-015 PIN, HB-029 bảo vệ tài chính, HB-120 hợp đồng OVER.
- F5: HB-093 ledger/phân bổ, HB-097 lập huỷ/hoàn, HB-099 maker–checker và HB-100 chi hoàn. HB-101/102 là UI khách, không phải phụ thuộc workflow tiền.

## Căn cứ

- F6 [backlog](../backlog-f6-f7.md), HB-124→HB-125.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-OVER-06…15, BR-INV-03/07, BR-GEN-07/08, BR-RBAC-02/03/05, BR-CANCEL-14…17, BR-PAY-07…09.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §6–9; [API](../../04-thiet-ke/api.md): §1.2/1.3/1.6, §2.8/3.10/4.1/6.3.
- [CSDL](../../04-thiet-ke/csdl.md): §3.2.5–3.2.6; [kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-08/09/11/13/18; SCR-44…47.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Create/plan không đổi assignment; execute với If-Match thiếu trả 428, cũ trả 412; version mới của move/merge và booking liên quan phải được đọc lại trong transaction — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_create_is_proposal_execute_rechecks_versions`.
2. Consent rút/thiếu sau lúc đề xuất trả `E_OVER_NO_CONSENT`; giới tính đổi/UNSPECIFIED đủ consent thiếu MANAGER duyệt kèm lý do trả `E_OVER_MERGE_GENDER`; không dùng consent/version DTO cũ thay DB hiện tại — test: `apps/api/test/over/merge.locked.spec.ts::TC_OVER_11_13_18_live_consent_gender_approval`.
3. Phòng/giường đích bị lấy trước execute trả `E_INV_ROOM_TAKEN` hoặc không còn availability đúng hợp đồng; kiểm mọi đêm, capacity, block, cleanup/khả dụng; nguồn còn nguyên và case chưa RESOLVED — test: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_18_target_taken_preserves_source`.
4. Hai execute cạnh tranh cùng đích chỉ một thành công; khóa nguồn/đích và aggregate theo thứ tự ổn định; không có assignment kép/giường chung giữa hai booking — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_concurrent_execute_one_winner`.
5. Lỗi chèn assignment, audit, outbox hoặc chứng từ sau nhả nguồn rollback tất cả: assignment/status/discount/quỹ hoàn/idempotency không dở dang — test: `apps/api/test/over/merge.locked.spec.ts::HB124_transaction_failure_rolls_back_all_effects`.
6. Người có scope nguồn nhưng thiếu scope đích hoặc một booking của merge bị trả `403 E_AUTH_OUT_OF_SCOPE`; endpoint duyệt không mở quyền qua FRONT_DESK/ACCOUNTANT/SYSADMIN; replay vẫn kiểm quyền hiện tại — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_source_target_scopes_and_replay_auth`.
7. `/room-moves/{id}/approve` và `/execute` yêu cầu PIN còn hiệu lực một lần gắn đúng actor/action; thiếu PIN trả `E_AUTH_PIN_REQUIRED`, sai/hết hạn/dùng lại bị từ chối theo hợp đồng AUTH; không log/lưu PIN thô — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_approve_execute_pin_enforced`.
8. CHECKED_IN không có căn cứ bất khả kháng trả `E_OVER_MOVE_NOT_ALLOWED`; có căn cứ nhưng thiếu MANAGER duyệt vẫn bị chặn; same-property zero-cost chưa check-in và SHARE cùng giới đủ consent theo BR không bị ép duyệt MANAGER ngoài quy tắc — test: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_09_force_majeure_approval_and_free_move`.
9. Thành công giữ `priceLocked=true`/đơn giá PriceSnapshot toàn kỳ; SPLIT_ROOMS chỉ đổi đơn vị, không tạo booking con/partial-cancel/snapshot giảm total; audit và outbox trong TX, thông báo ≤15 phút qua worker sau commit — test: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_08_SPLIT_ROOMS_price_units_no_child_booking`.
10. SHARE ghi discountAmount riêng, doanh thu phòng không giảm; chỉ nhả nguyên phòng khi không còn người/assignment liên quan, chỉ nhả giường thực đã rời — test: `apps/api/test/over/merge.locked.spec.ts::HB124_merge_cost_and_correct_unit_release`.
11. Walk-out lưu biên bản và hai chữ ký, yêu cầu hoàn PENDING gắn Payment gốc/phương thức gốc và khoản bồi thường riêng COMPENSATION; không chi khi chưa APPROVED, không sửa Payment gốc; mức tiền gross/net theo policy đã chốt — test: `apps/api/test/over/walkout.locked.spec.ts::TC_OVER_07_documents_refund_compensation_separated`.
12. Maker–checker mọi mức tiền: MANAGER/OWNER có scope nhưng khác maker, ACCOUNTANT chỉ payout sau duyệt; netRefund >5.000.000 xét tổng sự kiện, không tách né ngưỡng; quỹ PENDING/APPROVED + SUCCEEDED ≤ tiền hợp lệ từng Payment và booking — test: `apps/api/test/over/walkout.locked.spec.ts::HB124_refund_maker_checker_fund_lock_and_threshold`.
13. Replay cùng hash/version trả kết quả cũ không tạo assignment/RefundRequest/COMPENSATION/outbox lần hai, khác hash trả `E_SYS_IDEMPOTENCY_KEY_REUSED`; PSP timeout giữ chứng từ chờ đối soát và không gọi PSP trong TX — test: `apps/api/test/over/walkout.locked.spec.ts::HB124_replay_and_ambiguous_payout_no_double_spend`.
14. Resolve chỉ khi kiểm lại shortage thực tế bằng 0; ca ESCALATED/ngày đã qua vẫn xử lý được, giữ detectedAt/escalatedAt/delayReason, không dùng deadline để khóa cứu khách tại chỗ — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_resolve_requires_actual_shortage_zero`.
15. Walk-out của booking chưa gán phòng nhưng đang tạo demand vẫn huỷ nghiệp vụ theo HOTEL_RELOCATION: BookingRoom/demand/assignment/used được nhả đúng phạm vi, nghĩa vụ chưa ở được void và phân bổ tiền giải phóng/giữ hoàn theo HB-093/097; đầy đủ history/chứng từ/quỹ hoàn/audit/outbox cùng TX. Lỗi rollback phục hồi cả nguồn và nghĩa vụ; thành công shortage về 0 mới resolve được. Không áp policy khách huỷ thông thường hoặc tạo phạt do lỗi khách sạn — test: `apps/api/test/over/walkout.locked.spec.ts::HB124_unassigned_walkout_removes_demand_atomically`.
16. Chi COMPENSATION qua route HB-120 riêng: chỉ ACCOUNTANT có scope và PIN/action/amount hiện hành, RoomMove đã thực thi và chi phí đã được MANAGER/OWNER độc lập duyệt; không tự duyệt, không sửa khoản đã duyệt sau lúc chi. Hai request/worker hay replay khác API key vẫn chỉ một khoản chi cho cùng nghĩa vụ; amount từ server, tổng chi không vượt quyết định; thu/hoàn tiền gốc và refund reservation không bị thay đổi. Timeout giữ intent PENDING, tra giao dịch cũ, không tạo lần chi mới — test: `apps/api/test/over/compensation.locked.spec.ts::HB124_approved_compensation_payout_and_ambiguous_retry`.
17. FRONT_DESK đọc relocation-options chỉ cho booking trong scope và GET move/merge được phép; không đọc bảng rank/PII booking khác. Lệch scope hoặc bị thu quyền sau timeout/replay vẫn bị từ chối; đọc trả ETag và ID operation để đối soát — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_staff_projection_and_handoff_reads`.

## Ngoài phạm vi

- Implementation controller/use case (HB-125), worker scan (HB-127), UI/E2E thuộc ticket màn hình.
- Không mock chính transaction/DB exclusion/authorization/PSP idempotency đang kiểm; fake chỉ cho clock/provider ngoài biên và fault injection đúng port.

## Cổng phải xanh

Cổng cấu trúc `pnpm check:scope`, `npm run check`, type/lint phải xanh; **giai đoạn bàn giao test intentionally đỏ** phải có log lỗi vì thiếu hành vi, không import/config/environment failure. `pnpm run ci` được ghi đỏ có chủ đích với đúng test này, lead nhận bàn giao; HB-125 chỉ nộp sau full CI xanh trên commit triển khai. DB integration PostgreSQL 16 thật bắt buộc cho rollback/concurrency.

## Ghi chú cho người làm

- Mỗi AC có tên test độc lập; assertion quan sát trạng thái persisted trước/sau và side effect count. Không `skip`/`todo` để che blocker.
- TC-OVER-13 thiếu duyệt khi đủ consent phải dùng `E_OVER_MERGE_GENDER`, kế hoạch 05 đã được đồng bộ trong PR công bố đặc tả theo QĐ-05; docs02 protected mâu thuẫn phải báo lead, không sửa tự động.
- HB-125 không được đổi helper làm yếu Oracle; helper đã bàn giao cũng phải giữ nguyên. Chốt PIN của approve/execute merge bằng bổ sung hợp đồng HB-120 theo BR-RBAC-05 cho đường tài chính trước khi khóa test.
- Phương thức/adapter chi bồi thường phải được lead xác nhận trước AC16. Không coi HB-100 (chi REFUND) tự động bao phủ COMPENSATION; dùng lại operation/PSP port được hỗ trợ, không tái dùng reservation của nguồn thu cho bồi thường.
- Giai đoạn A test đỏ chưa thể merge bằng quy trình hiện tại: AGENTS §3/sổ tay lead §4 yêu cầu CI xanh còn §3.6 yêu cầu merge test đỏ trước B. Lead chốt cách bàn giao A bất biến và tích hợp A+B với CI xanh; không cho phép skip, đổi CI hoặc tự mở lead branch để né scope. Ghi rõ điểm này trong báo cáo đặc tả trước giao A.
