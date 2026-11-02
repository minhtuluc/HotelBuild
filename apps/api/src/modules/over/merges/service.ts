/**
 * Ghép phòng `MERGE_SHARE`/`MERGE_CONNECTING` (HB-125 AC7, F6-D01/D03/D04).
 *
 * `MERGE_CONNECTING` là **một** booking với hai phòng (không consent); `MERGE_SHARE` là hai booking
 * độc lập, cùng giường riêng, cần hai consent và duyệt MANAGER khi khác giới (BR-OVER-13/14).
 * Doanh thu/PriceSnapshot giữ nguyên; chiết khấu ghi riêng và nghĩa vụ phải thu làm tròn **xuống**
 * ở cấp tổng (F6-D03), không tạo booking con hay huỷ một phần.
 *
 * Service chỉ giữ luồng giao dịch dùng chung (khoá lệnh, kiểm tra phạm vi, PIN, If-Match); phần tạo
 * và thực thi từng loại ghép nằm ở `share-create.ts`, `share-execute.ts`, `connecting.ts`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@pinehill/domain';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { CLOCK } from '../../../infrastructure/ports.js';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { PIN_PURPOSE_FINANCIAL, requirePinToken } from '../../auth/pin/consume.js';
import { moveExecuteInput } from '../moves/validation.js';
import {
  businessConflict,
  mergeETag,
  notFound,
  requireIfMatch,
  writeIntentOf,
  type Tx,
} from '../support.js';
import type { MergeRow } from '../views.js';
import { createConnecting, executeConnecting } from './connecting.js';
import { lockMerge, requireMergeScope } from './queries.js';
import { createShare } from './share-create.js';
import { executeShare } from './share-execute.js';
import { mergeApproveInput, mergeConsentInput, mergeCreateInput } from './validation.js';
import { mergeBodyOf } from './view.js';

@Injectable()
export class RoomMergeService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditWriter) private readonly audit: AuditWriter,
  ) {}

  async create(tx: Tx, actor: AuthorizedActor, body: unknown) {
    const command = mergeCreateInput(body);
    if (command.moveType === 'MERGE_CONNECTING')
      return createConnecting(tx, actor, command, this.audit);
    return createShare(tx, actor, command, this.audit);
  }

  async consent(tx: Tx, actor: AuthorizedActor, mergeId: string, body: unknown) {
    const input = mergeConsentInput(body);
    const row = await lockMerge(tx, mergeId);
    await requireMergeScope(tx, actor, row);
    if (row.move_type !== 'MERGE_SHARE')
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Ghép thông nhau không có consent.');
    if (!['PENDING_CONSENT', 'APPROVED'].includes(row.status))
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Merge không còn nhận consent.');
    const now = this.clock.now();
    const primary = input.side === 'PRIMARY' ? input.consented : row.consent_primary;
    const secondary = input.side === 'SECONDARY' ? input.consented : row.consent_secondary;
    const status = primary && secondary ? 'APPROVED' : 'PENDING_CONSENT';
    await tx.$executeRaw`
      UPDATE room_merges SET consent_primary=${primary}, consent_secondary=${secondary},
             status=${status}, updated_at=${now}::timestamptz
       WHERE id=${row.id}::uuid`;
    await this.audit.record(tx, {
      actor,
      action: 'ROOM_MERGE_CONSENT',
      entityType: 'RoomMerge',
      entityId: row.id,
      beforeJson: { consentPrimary: row.consent_primary, consentSecondary: row.consent_secondary },
      afterJson: {
        side: input.side,
        consented: input.consented,
        consentPrimary: primary,
        consentSecondary: secondary,
        status,
        evidenceUrl: input.evidenceUrl ?? null,
      },
      reason: null,
    });
    return mergeBodyOf(tx, await lockMerge(tx, mergeId));
  }

  async approve(tx: Tx, actor: AuthorizedActor, mergeId: string, body: unknown) {
    const input = mergeApproveInput(body);
    const row = await lockMerge(tx, mergeId);
    await requireMergeScope(tx, actor, row);
    if (!['PENDING_CONSENT', 'APPROVED'].includes(row.status))
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Merge không còn chờ duyệt.');
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: row.primary_booking_id,
      now: this.clock.now(),
    });
    const now = this.clock.now();
    await tx.$executeRaw`
      UPDATE room_merges SET approved_by=${actor.id}::uuid, updated_at=${now}::timestamptz
       WHERE id=${row.id}::uuid`;
    await this.audit.record(tx, {
      actor,
      action: 'ROOM_MERGE_APPROVED',
      entityType: 'RoomMerge',
      entityId: row.id,
      beforeJson: { approvedBy: row.approved_by, status: row.status },
      afterJson: { approvedBy: actor.id, status: row.status, reason: input.reason },
      reason: input.reason,
    });
    return mergeBodyOf(tx, await lockMerge(tx, mergeId));
  }

  async execute(tx: Tx, actor: AuthorizedActor, mergeId: string, body: unknown, ifMatch: unknown) {
    const input = moveExecuteInput(body);
    const row = await lockMerge(tx, mergeId);
    await requireMergeScope(tx, actor, row);
    if (!['PENDING_CONSENT', 'APPROVED'].includes(row.status))
      throw businessConflict('E_OVER_MOVE_NOT_ALLOWED', 'Merge không còn hiệu lực.');
    const now = this.clock.now();
    await requirePinToken(tx, {
      userId: actor.id,
      token: input.pinToken,
      purpose: PIN_PURPOSE_FINANCIAL,
      bookingId: row.primary_booking_id,
      now,
    });
    requireIfMatch(ifMatch, mergeETag(row.version));
    if (row.move_type === 'MERGE_CONNECTING')
      await executeConnecting(tx, actor, row, now, this.audit);
    else await executeShare(tx, actor, row, now, this.audit);
    return mergeBodyOf(tx, await lockMerge(tx, mergeId));
  }

  async read(actor: AuthorizedActor, mergeId: string, query: unknown) {
    const rows = await this.db.$queryRaw<MergeRow[]>`
      SELECT * FROM room_merges WHERE id=${mergeId}::uuid`;
    const row = rows[0];
    if (row === undefined) throw notFound('Không tìm thấy lệnh ghép phòng.');
    await requireMergeScope(this.db, actor, row);
    const key =
      typeof query === 'object' && query !== null && 'idempotencyKey' in query
        ? String(query.idempotencyKey)
        : undefined;
    const writeIntent = await writeIntentOf(this.db, actor, key, 'ROOM_MERGE', row.id, row.id);
    return { etag: mergeETag(row.version), body: await mergeBodyOf(this.db, row, writeIntent) };
  }
}
