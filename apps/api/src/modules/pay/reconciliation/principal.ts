/**
 * Luật chủ thể/quyền và kiểm thân lệnh của `POST /reconciliation/daily/close` (HB-150; api.md §2.6, §6.1).
 */
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import type { ReconciliationCloseRequest } from '@pinehill/contracts';
import { reconciliationCloseRequestSchema } from '@pinehill/contracts';
import { forbidden, invalid, outOfScope } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Kiểm thân lệnh: sai cú pháp → 400 trước khi tra tài nguyên (không để lại idempotency rác). */
export function reconciliationCommand(value: unknown): ReconciliationCloseRequest {
  const parsed = reconciliationCloseRequestSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

/** Quyền + phạm vi cơ sở của lệnh chốt đối soát; gọi ở `ReconciliationAccess` và đọc lại trong transaction. */
export function requireReconcile(actor: AuthorizedActor, propertyId: string): void {
  if (!actor.hasPermission('reconciliation.close')) throw forbidden();
  if (!actor.canActOn(propertyId)) throw outOfScope();
}
