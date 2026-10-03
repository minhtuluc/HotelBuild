---
id: HB-125
title: Hiện thực endpoint OVER qua bộ test khóa HB-124
risk: R2
owner: deepseek
max_lines: 1100
allow:
  - apps/api/src/modules/over/planning/**
  - apps/api/src/modules/over/moves/**
  - apps/api/src/modules/over/merges/**
  - apps/api/src/modules/over/resolution/**
  - apps/api/src/modules/over/compensation/**
  - apps/api/src/modules/over/permissions.ts
  - apps/api/src/modules/over/over.module.ts
  - apps/api/src/app.module.ts
  - apps/api/src/infrastructure/prisma/over/**
  - apps/api/test/over/endpoints.spec.ts
  - apps/api/test/over/routes.spec.ts
locked:
  - apps/api/test/over/relocation.locked.spec.ts
  - apps/api/test/over/merge.locked.spec.ts
  - apps/api/test/over/walkout.locked.spec.ts
  - apps/api/test/over/compensation.locked.spec.ts
  - apps/api/test/over/helpers/**
  - packages/domain/test/overbooking/**
---

# HB-125 — Use case và endpoint OVER

**Trạng thái công bố:** đặc tả trước triển khai. Đối chiếu [các điểm F6 chưa chốt](../f6-diem-cho-chot.md) trước nhận việc; phần chịu ảnh hưởng vẫn BLOCKED cho tới khi có quyết định minh thị.

## Mục tiêu

DeepSeek triển khai phần B của R2 đúng hợp đồng HB-120 và bộ test khóa Codex HB-124, nối engine/UnitOfWork/PAY có sẵn. Vòng đề xuất→đồng thuận/duyệt→execute không mất assignment nguồn khi lỗi; walk-out không tự chi tiền qua controller. Không sửa Oracle để đạt xanh.

## Phụ thuộc

- HB-124 có commit/log đỏ và bàn giao fixture/helper khóa; HB-121/122/123 đủ schema/policy.
- HB-120 hợp đồng CHAN+OVER; HB-029 bảo vệ tài chính, HB-015 PIN, HB-014 RBAC; HB-007 DB/UnitOfWork, HB-009 audit, HB-076 khoá tồn; outbox theo ADR-017 và relay HB-130.
- HB-130 consumer thông báo và HB-127 runtime đã có để nghiệm thu worker/timing; không chờ F8.
- Refund/ledger F5: HB-093 (ledger), HB-097 (lập hồ sơ), HB-099 (maker–checker), HB-100 (chi hoàn). HB-101/102 là UI khách, không thuộc workflow tiền.

## Căn cứ

- Pha F6 [backlog](../backlog-f6-f7.md), HB-125.
- [Quy tắc nghiệp vụ](../../02-nghiep-vu/quy-tac-nghiep-vu.md): BR-OVER-06…16, BR-INV-03/07, BR-GEN-07/08, BR-RBAC-02/03/05, BR-CANCEL-14…17, BR-PAY-07…09.
- [Quá tải](../../02-nghiep-vu/qua-tai-ghep-doi-phong.md): §6–9; [API](../../04-thiet-ke/api.md): §1.2–1.6, §2.8, §3.10, §4.1, §6.3.
- [Kiểm thử](../../05-ke-hoach/ke-hoach-kiem-thu.md): TC-OVER-08/09/11/13/16/18; SCR-44…47/63.

## Endpoint trong phạm vi

`POST /api/v1/overbooking-cases/{caseId}/relocation-plan`, `/resolve`; `POST /api/v1/room-moves`, `/{roomMoveId}/approve`, `/{roomMoveId}/execute`; `POST /api/v1/room-merges`, `/{roomMergeId}/consent`, `/{roomMergeId}/approve`, `/{roomMergeId}/execute`. Các bổ sung HB-120: GET move/merge, GET `/bookings/{bookingId}/relocation-options`, GET/POST `/room-moves/{roomMoveId}/compensation-payments`. GET case list/detail và booking alerts thuộc HB-126.

## Tiêu chí nghiệm thu (mỗi dòng ↔ một test)

1. Các route trên đăng ký và validate DTO từ contracts HB-120; create 201 + Location, error cùng envelope; không mass-assign status/approvedBy/paidAmount/price; mọi ghi Idempotency-Key — test: `apps/api/test/over/routes.spec.ts::HB125_contract_routes_headers_and_server_fields`.
2. Relocation-plan trả metadata đầy đủ điểm/nhóm/khoá seq và preview bốn bậc, chọn 1→2→4 cho địa lý hiện tại, không thay assignment — test: `apps/api/test/over/endpoints.spec.ts::HB125_plan_explains_order_without_inventory_change`.
3. Phiên có đúng quyền hiện tại + scope nguồn/đích/cả hai booking mới tạo/duyệt/execute; replay vẫn kiểm quyền; PIN approve/execute theo hợp đồng/action hiện tại, không dùng lại — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_source_target_scopes_and_replay_auth`, `::HB124_approve_execute_pin_enforced`.
4. Execute mở TX khóa aggregate và đơn vị nguồn/đích theo thứ tự ổn định; đọc lại version/consent/gender/approval/status/price/capacity/tồn mọi đêm; If-Match 428/412 đúng — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_create_is_proposal_execute_rechecks_versions`, `apps/api/test/over/merge.locked.spec.ts::TC_OVER_11_13_18_live_consent_gender_approval`.
5. Giải phóng nguồn + gán đích + trạng thái + audit + outbox + kết quả idempotency cùng commit; lỗi/đích bị chiếm/execute cạnh tranh không mất nguồn, không RESOLVED giả — test: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_18_target_taken_preserves_source`, `::HB124_concurrent_execute_one_winner`, `apps/api/test/over/merge.locked.spec.ts::HB124_transaction_failure_rolls_back_all_effects`.
6. Giữ giá gốc/priceLocked cho mọi RoomMove, SPLIT_ROOMS giữ từng đơn vị giá và không tạo booking con/partial cancellation; CHECKED_IN cần căn cứ bất khả kháng + MANAGER duyệt — test: `apps/api/test/over/relocation.locked.spec.ts::TC_OVER_08_SPLIT_ROOMS_price_units_no_child_booking`, `::TC_OVER_09_force_majeure_approval_and_free_move`.
7. Ghép đủ consent, capacity và riêng giường, discount ghi chi phí tách doanh thu; khác giới/UNSPECIFIED chỉ cho ngoại lệ hợp lệ; linking connecting chỉ hiện thực sau lead chốt representation — test: `apps/api/test/over/merge.locked.spec.ts::HB124_merge_cost_and_correct_unit_release`.
8. Walk-out lưu chứng từ/chữ ký; lập yêu cầu hoàn và bồi thường riêng; PAY quyết định duyệt/chi, maker khác checker cả OWNER, quỹ hoàn khóa từng nguồn + booking, không PSP trong TX và không sửa Payment gốc — test: `apps/api/test/over/walkout.locked.spec.ts::TC_OVER_07_documents_refund_compensation_separated`, `::HB124_refund_maker_checker_fund_lock_and_threshold`.
9. Retry không tạo chứng từ/assignment/outbox/chi lần hai; không retry payout mới khi PSP chưa rõ kết quả; chỉ phát thông báo/outbox sau commit, guest notification ≤15 phút — test: `apps/api/test/over/walkout.locked.spec.ts::HB124_replay_and_ambiguous_payout_no_double_spend`.
10. Resolve cần kiểm shortage hiện tại=0, resolvedAt/resolvedBy/resolution note; giữ lịch sử/delayReason khi quá hạn; ca ESCALATED vẫn xử lý theo sự cố tại chỗ — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_resolve_requires_actual_shortage_zero`.
11. Tất cả test HB-124 xanh nguyên vẹn, không skip/only/nới assertion/mock phần đang kiểm — test: `apps/api/test/over/endpoints.spec.ts::HB125_locked_suite_integration` và cả bộ locked HB-124.
12. Walk-out không có đích, kể cả booking oversold chưa có assignment: nối lệnh HOTEL_RELOCATION của HB-097 và ledger HB-093 để kết thúc demand/nghĩa vụ/used đúng phạm vi, trả phòng, giữ quỹ hoàn và ghi history/chứng từ/audit/outbox trong một TX. Toàn booking thì chuyển CANCELLED; phạm vi BookingRoom nhỏ hơn phải có hợp đồng rõ, giữ phòng còn lại theo BR-CANCEL-19. Không dùng đường guest-cancel để áp penalty hoặc tạo success khi booking vẫn chiếm demand — test: `apps/api/test/over/walkout.locked.spec.ts::HB124_unassigned_walkout_removes_demand_atomically`.
13. Thực hiện chi bồi thường qua module compensation riêng và port thanh toán được lead chốt; ACCOUNTANT chi sau phê duyệt theo số tiền/version server, PIN ràng buộc đúng hành động. Intent/Payment COMPENSATION bền, unique theo nghĩa vụ RoomMove; không thay paidAmount/refundedAmount hay dùng quỹ RefundRequest. Payout I/O ngoài TX, pending/timeout tra operation cũ trước retry; đọc chứng từ đúng projection — test: `apps/api/test/over/compensation.locked.spec.ts::HB124_approved_compensation_payout_and_ambiguous_retry`.
14. GET move/merge trả ETag, allowedActions và trạng thái/chứng từ tối thiểu; relocation-options cho FRONT_DESK chỉ booking được giao, đọc tồn hiện tại không giữ chỗ và không lộ bảng keepScore toàn bộ. Dùng các route này sau handoff/timeout trước ý định mới — test: `apps/api/test/over/relocation.locked.spec.ts::HB124_staff_projection_and_handoff_reads`.

## Ngoài phạm vi

- Sửa schema/policy/contracts/test khóa; OTA inbox (HB-128/129), scanner (HB-127), UI (HB-135…139). Consumer gửi thông báo điều chuyển tối thiểu thuộc HB-130 (không chờ module NOTI F8); HB-125 phát event/payload được phép trong TX.
- Tự đổi luật tiền, role hay địa lý; nếu cần helper ngoài allow giải trình, nếu vượt R2 stage B báo Codex/lead.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm check:contract` · `npm run check` nếu đụng docs/scripts. Backend chạy thật: `pnpm infra:up`, migrate, gọi đủ create/approve/execute/resolve và một ca lỗi tranh chấp trên PG16; log không chứa PII/PIN/token, ghi SHA bằng chứng.

## Ghi chú cho người làm

- Không nới DB CHECK để lách blocker; dùng migration tiến HB-121 đã được review. PIN các route merge tài chính phải thống nhất contracts HB-120 trước khi viết.
- Không dùng `E_OVER_CASE_DEADLINE_PASSED` như lệnh cấm mọi execute khi trễ; BR-OVER-16 vẫn bắt xử lý tại chỗ. Lead/HB-120 chốt bổ sung ngữ nghĩa lỗi hợp đồng nếu route hiện chỉ biết từ chối.
- Nếu không có quỹ hoàn đủ do yêu cầu khác đang giữ, trả xung đột để đối soát, không âm thầm giảm số tiền phải hoàn.
- Lead xác nhận mở rộng chi COMPENSATION và adapter có năng lực chi trước bàn giao phần B; phần này có test khoá HB-124 và schema HB-121. HB-096 chỉ thu tiền tại quầy, HB-100 chỉ chi REFUND; không sửa đặc tả F5 trên main để gán thêm trách nhiệm ngầm.
- Dependency vận hành: HB-130 consumer thông báo/transport phải tích hợp trước nghiệm thu thông báo ≤15 phút; một OutboxEvent mới không chứng minh khách đã nhận.
