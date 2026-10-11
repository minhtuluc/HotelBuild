import { Prisma } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { AppError } from '../../../common/app-error.js';
import { RetryTransaction } from '../../../common/idempotency/transaction-retry.js';
import { conflict, typedValue } from './command-input.js';
import { safeSnapshot } from '../audit-logs/projection.js';
import { safeAuditText, secretSettingKey } from '../audit-logs/safe-text.js';
import { forbidden, missing } from './validation.js';
export type SettingInput = { value: string; reason: string };
export async function authorize(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  key: string,
  input: SettingInput,
) {
  if (actor.role !== 'OWNER') throw forbidden();
  const setting = await tx.system_settings.findUnique({ where: { key } });
  if (!setting) throw missing();
  typedValue(input.value, setting.value_type, key);
  return setting;
}
export async function updateSetting(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  key: string,
  input: SettingInput,
  expected: bigint,
  clock: Clock,
) {
  try {
    return await writeSetting(tx, actor, key, input, expected, clock);
  } catch (error) {
    if (error instanceof AppError || error instanceof RetryTransaction) throw error;
    if (retryable(error))
      throw new RetryTransaction(
        new AppError(
          409,
          'E_SYS_REQUEST_IN_PROGRESS',
          'Tham số đang được cập nhật; hãy thử lại.',
          1,
        ),
      );
    throw new Error('SYS_SETTING_WRITE_FAILURE');
  }
}

function retryable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && ['55P03', '40P01', '40001'].includes(String(error.meta?.code))))
  );
}
function auditValue(value: string, type: string, key: string): string {
  if (secretSettingKey(key)) return '[REDACTED]';
  if (type === 'NUMBER') return Number.isFinite(Number(value)) ? value : '[INVALID_NUMBER]';
  if (type === 'BOOLEAN') return ['true', 'false'].includes(value) ? value : '[INVALID_BOOLEAN]';
  if (type === 'JSON') {
    try {
      const parsed: unknown = JSON.parse(value);
      return JSON.stringify(safeSnapshot(parsed));
    } catch {
      return '[INVALID_JSON]';
    }
  }
  return safeAuditText(value);
}
async function writeSetting(
  tx: Prisma.TransactionClient,
  actor: AuthorizedActor,
  key: string,
  input: SettingInput,
  expected: bigint,
  clock: Clock,
) {
  await authorize(tx, actor, key, input);
  await tx.$executeRaw`SET LOCAL lock_timeout='1s'`;
  await tx.$queryRaw`SELECT id FROM system_settings WHERE key=${key} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM users WHERE id=${actor.id}::uuid FOR SHARE`;
  const current = await tx.users.findUnique({
    where: { id: actor.id },
    select: { role: true, is_active: true },
  });
  if (!current?.is_active || current.role !== 'OWNER') throw forbidden();
  const before = await authorize(tx, actor, key, input);
  if (before.version !== expected || before.version >= BigInt(Number.MAX_SAFE_INTEGER))
    throw conflict();
  const after = await tx.system_settings.update({
    where: { id: before.id },
    data: { value: input.value, updated_by: actor.id, updated_at: clock.now() },
  });
  await new AuditWriter(clock).record(tx, {
    actor,
    action: 'SYSTEM_SETTING_UPDATED',
    entityType: 'SystemSetting',
    entityId: before.id,
    beforeJson: {
      key,
      value: auditValue(before.value, before.value_type, key),
      valueType: before.value_type,
      version: Number(before.version),
    },
    afterJson: {
      key,
      value: auditValue(after.value, after.value_type, key),
      valueType: after.value_type,
      version: Number(after.version),
    },
    reason: input.reason,
  });
  return after.version;
}
