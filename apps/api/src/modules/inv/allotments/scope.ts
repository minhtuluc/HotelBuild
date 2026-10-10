import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../../common/app-error.js';

export interface AllotmentScope {
  channelId: string;
  roomTypeId: string;
}
const maximumVersion = 9223372036854775807n;
const versionConflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Phiên bản cấu hình allotment đã thay đổi.');

export function allotmentExpectedVersion(value: unknown): bigint {
  if (value === undefined)
    throw new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Thiếu If-Match.');
  if (typeof value !== 'string' || !/^"[1-9]\d{0,18}"$/.test(value)) throw versionConflict();
  const version = BigInt(value.slice(1, -1));
  if (version > maximumVersion) throw versionConflict();
  return version;
}

export function allotmentETag(version: bigint): string {
  return `"${version}"`;
}

const configurationRow = z.object({
  version: z.bigint().positive(),
  date: z.string().nullable(),
  allotment: z.number().int().nonnegative().nullable(),
  isClosed: z.boolean().nullable(),
  closedReason: z.string().nullable(),
  closedAt: z.string().nullable(),
});

/** Validated scope/dates; [from,to). One statement snapshot, no lock/write; used is not configuration. */
export async function readAllotmentConfiguration(
  tx: Prisma.TransactionClient,
  scope: AllotmentScope,
  from: string,
  to: string,
) {
  const rows = z
    .array(configurationRow)
    .nonempty()
    .parse(
      await tx.$queryRaw`
    SELECT coalesce(s.version,1::bigint) AS version,
      to_char(a.date,'YYYY-MM-DD') AS date, a.allotment,
      a.is_closed AS "isClosed", a.closed_reason AS "closedReason",
      to_char(a.closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "closedAt"
    FROM (SELECT ${scope.channelId}::uuid AS channel_id, ${scope.roomTypeId}::uuid AS room_type_id) pair
    LEFT JOIN channel_allotment_scopes s USING(channel_id,room_type_id)
    LEFT JOIN channel_allotments a ON a.channel_id=pair.channel_id AND a.room_type_id=pair.room_type_id
      AND a.date>=${from}::date AND a.date<${to}::date
    ORDER BY a.date
  `,
    );
  return {
    version: rows[0]!.version,
    items: rows.flatMap((row) =>
      row.date !== null && row.allotment !== null && row.isClosed !== null
        ? [
            {
              date: row.date,
              allotment: row.allotment,
              isClosed: row.isClosed,
              closedReason: row.closedReason,
              closedAt: row.closedAt,
            },
          ]
        : [],
    ),
  };
}

/**
 * Call inside the caller's READ COMMITTED transaction BEFORE child writes. Retains the lock until
 * that transaction ends; caller owns authorization, quota validation, audit, idempotency and retries.
 * Scope moves must acquire both keys in sorted order. Never call through an autocommit client.
 */
export async function lockAllotmentScope(
  tx: Prisma.TransactionClient,
  scope: AllotmentScope,
  expectedVersion: bigint,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO channel_allotment_scopes(channel_id,room_type_id)
    VALUES(${scope.channelId}::uuid,${scope.roomTypeId}::uuid)
    ON CONFLICT(channel_id,room_type_id) DO NOTHING
  `;
  const rows = z
    .array(z.object({ version: z.bigint() }))
    .length(1)
    .parse(
      await tx.$queryRaw`
    SELECT version FROM channel_allotment_scopes
    WHERE channel_id=${scope.channelId}::uuid AND room_type_id=${scope.roomTypeId}::uuid
    FOR UPDATE
  `,
    );
  if (rows[0]!.version !== expectedVersion) throw versionConflict();
}
