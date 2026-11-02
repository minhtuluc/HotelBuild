/**
 * Dựng body `room_merges` trả về cho client: consent, đánh giá cùng giới và các hành động được phép.
 * Chỉ đọc, dùng chung cho mọi endpoint của `RoomMergeService`.
 */
import type { PrismaClient } from '@prisma/client';
import type { Tx } from '../support.js';
import { mergeView, type MergeRow } from '../views.js';
import { gendersOf } from './queries.js';

function genderSameOf(left: string, right: string): boolean {
  if (left === 'UNSPECIFIED' || right === 'UNSPECIFIED') return false;
  return left === right;
}

export async function mergeBodyOf(
  tx: Tx | PrismaClient,
  row: MergeRow,
  writeIntent: unknown = null,
) {
  const genders =
    row.move_type === 'MERGE_SHARE' && row.secondary_booking_id !== null
      ? await shareGenders(tx, row)
      : { same: null };
  return mergeView(row, {
    consents: consentsOf(row),
    genderSame: genders.same,
    allowedActions: actionsOf(row, genders.same),
    writeIntent,
    operationId: row.id,
  });
}

function consentsOf(row: MergeRow) {
  const at = row.updated_at.toISOString();
  const by = row.approved_by ?? row.primary_booking_id;
  return [
    ...(row.consent_primary || row.move_type === 'MERGE_SHARE'
      ? [
          {
            side: 'PRIMARY' as const,
            consented: row.consent_primary,
            evidenceUrl: null,
            recordedBy: by,
            recordedAt: at,
          },
        ]
      : []),
    ...(row.consent_secondary || row.move_type === 'MERGE_SHARE'
      ? [
          {
            side: 'SECONDARY' as const,
            consented: row.consent_secondary,
            evidenceUrl: null,
            recordedBy: by,
            recordedAt: at,
          },
        ]
      : []),
  ];
}

function actionsOf(row: MergeRow, genderSame: boolean | null): readonly string[] {
  if (row.status === 'ACTIVE' || row.status === 'CANCELLED') return [];
  if (row.move_type === 'MERGE_CONNECTING') return ['EXECUTE'];
  if (!row.consent_primary || !row.consent_secondary) return ['RECORD_CONSENT'];
  return row.approved_by === null && genderSame !== true ? ['APPROVE', 'EXECUTE'] : ['EXECUTE'];
}

async function shareGenders(
  tx: Tx | PrismaClient,
  row: MergeRow,
): Promise<{ same: boolean | null }> {
  if (row.secondary_booking_id === null) return { same: null };
  const rows = await tx.$queryRaw<
    { id: string; guest_id: string }[]
  >`SELECT id, guest_id FROM bookings
      WHERE id = ANY(${[row.primary_booking_id, row.secondary_booking_id]}::uuid[])`;
  const genders = await gendersOf(
    tx,
    rows.map((item) => item.guest_id),
  );
  const guestIds = rows.map((item) => item.guest_id);
  if (guestIds.length !== 2) return { same: null };
  return {
    same: genderSameOf(
      genders.get(guestIds[0]!) ?? 'UNSPECIFIED',
      genders.get(guestIds[1]!) ?? 'UNSPECIFIED',
    ),
  };
}
