# Published channel catalogue

This HB-055 read slice implements only the published `GET /api/v1/channels`
needed by HB-042. MANAGER and OWNER read the global chain defaults; UUID cursor,
limit 1–100 (default50), independent row-count/page snapshot and `no-store`.
It does not resolve property overrides or return private sync/credential fields.
Bigint versions outside the safe integer range fail instead of rounding.

No channel mutation, property override, detail, promotion, floor warning or
quote snapshot semantics are accepted by this slice. Whole HB-055 remains open.
GET holds no row locks and emits no mutation/audit/outbox/idempotency record.
