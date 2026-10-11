import { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { authorizeActor } from '../../../common/actor/authorized-actor.js';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { safeText } from './validation.js';
import { forbidden, missing, invalid } from './support.js';
export const permission = (kind: string) =>
  kind === 'property' || kind === 'type' ? 'propertyAdmin.configure' : 'propertyAdmin.rooms';
export async function currentActor(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  propertyId: string,
  permissionName: string,
  registry: PermissionRegistry,
) {
  await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT user_id FROM user_property_scopes WHERE user_id=${actor.id}::uuid AND property_id=${propertyId}::uuid FOR SHARE`;
  const user = await tx.users.findUnique({
    where: { id: actor.id },
    include: { user_property_scopes: true },
  });
  if (!user?.is_active || user.role !== actor.role) throw forbidden();
  const now = authorizeActor(
    { ...actor, role: user.role },
    user.user_property_scopes.map((x) => x.property_id),
    registry,
  );
  if (!now.hasPermission(permissionName)) throw forbidden();
  requireProperty(now, propertyId);
  return now;
}
export async function lockProperty(tx: Prisma.TransactionClient, propertyId: string) {
  await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
  const r = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM properties WHERE id=${propertyId}::uuid FOR UPDATE`;
  if (!r.length) throw missing();
}
export async function record(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  clock: Clock,
  type: string,
  id: string,
  propertyId: string,
  before: Prisma.InputJsonObject | null,
  after: Prisma.InputJsonObject,
  reason: string,
) {
  const clean = (value: Prisma.InputJsonObject) =>
    Object.fromEntries(
      Object.entries(value).map(([key, part]) => [
        key,
        typeof part === 'string' && ['name', 'note'].includes(key) ? safeText(part) : part,
      ]),
    );
  await new AuditWriter(clock).record(tx, {
    actor,
    entityType: type,
    entityId: id,
    action: 'PROP_' + type.toUpperCase() + (before ? '_UPDATED' : '_CREATED'),
    beforeJson: before ? { ...clean(before), propertyId } : null,
    afterJson: { ...clean(after), propertyId },
    reason: safeText(reason),
  });
}
function duplicate(error: Prisma.PrismaClientKnownRequestError) {
  return error.code === 'P2002' || (error.code === 'P2010' && error.meta?.code === '23505');
}
function retryable(error: Prisma.PrismaClientKnownRequestError) {
  return (
    error.code === 'P2034' ||
    (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code)))
  );
}
export function safeError(error: unknown): never {
  if (error instanceof AppError || error instanceof RetryTransaction) throw error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (duplicate(error))
      throw new AppError(409, 'E_PROP_CODE_TAKEN', 'Mã đã được sử dụng trong cơ sở.');
    if (retryable(error))
      throw new RetryTransaction(
        new AppError(409, 'E_INV_LOCK_TIMEOUT', 'Cấu hình đang bận; hãy thử lại.', 1),
      );
  }
  throw new Error('PROP_CONFIGURATION_WRITE_FAILURE');
}
export function checkRoomCode(code: string, propertyCode: string) {
  const prefix = propertyCode.replaceAll('-', '');
  if (!/^CS0[123]-\d{3,}$/.test(code) || !code.startsWith(prefix + '-')) throw invalid();
}
