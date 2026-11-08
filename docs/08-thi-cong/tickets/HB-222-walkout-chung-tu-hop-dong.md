---
id: HB-222
title: Walk-out nhận chứng từ đúng hợp đồng (`walkOut` lồng) — SCR-44 thực thi được walk-out
risk: R1
owner: claude
max_lines: 200
allow:
  - apps/api/src/modules/over/moves/validation.ts
  - apps/api/test/over/walkout-contract-body.spec.ts
---

# HB-222 — Walk-out nhận chứng từ đúng hợp đồng

## Mục tiêu

`POST /room-moves` với `moveType = WALK_OUT` gửi đúng `roomMoveCreateRequestSchema` (biên bản và chữ ký trong `walkOut: {walkOutDocNo, guestSignatureRef, staffSignatureRef, …}` — body SCR-44 ops-web `hb136-scr44-dieu-chuyen/model.ts::moveRequest`) phải lưu chứng từ, để lệnh walk-out đã duyệt thực thi được.

## Nguyên nhân (QA HB-194, QA-F6-06)

`moves/validation.ts::flatMoveSchema` chỉ khai báo trường phẳng `walkOutDocNo`/`guestSignatureRef`/`staffSignatureRef` (hình dạng harness test khoá HB-124). `z.object` bỏ êm `walkOut` lồng, nên `room_moves.walk_out_doc_no` = NULL và `execute` luôn `409 E_OVER_MOVE_NOT_ALLOWED` ("Walk-out phải có biên bản…", BR-CANCEL-14).

## Tiêu chí nghiệm thu

1. Body đúng hợp đồng lưu đủ chứng từ, phản hồi có `walkOut`, MANAGER duyệt (PIN) rồi lễ tân thực thi (PIN) ⇒ `EXECUTED` — test: `apps/api/test/over/walkout-contract-body.spec.ts::HB222_contract_walkout_body_keeps_documents_and_executes`.
2. Body có cả hai dạng mà chứng từ khác nhau ⇒ `400 E_GEN_VALIDATION_FAILED` — test: `…::HB222_conflicting_flat_and_nested_documents_rejected`.
3. Dạng phẳng của HB-124 vẫn chạy — test khoá `apps/api/test/over/walkout.locked.spec.ts` xanh, không sửa.

## Ngoài phạm vi

Không đổi luật walk-out/hoàn/bồi thường. `refundRequestId`/`compensationPaymentId` trong `walkOut` của client bị bỏ qua (máy chủ gắn khi thực thi). Lưu `overbookingCaseId`/`consent` của RoomMove cần DDL (QA-F6-05) — ghi nợ riêng.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · integration `apps/api/test/over/**`.
