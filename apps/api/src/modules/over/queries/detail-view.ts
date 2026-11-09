/**
 * HB-220 — phần bổ sung của `GET /overbooking-cases/{caseId}` cho đúng `overbookingCaseDetailSchema`:
 *
 * - `candidates`: giữ nguyên thứ tự và điểm của bộ chọn HB-126 (`keepScore` số + `keepScoreBreakdown`),
 *   chỉ **thêm** dữ kiện booking mà bảng điều chuyển cần hiển thị (thứ hạng, tên đã che, kỳ ở, tiền).
 *   Không tính lại điểm, không sắp lại.
 * - `history`: các mốc bền đã có trên ca (`detected_at`, `escalated_at`, `resolved_at`); không bịa mốc
 *   cho trạng thái không có cột thời gian.
 */
import type { PrismaClient } from '@prisma/client';
import { businessDate, maskedName, money, nightsBetween } from '../support.js';
import type { BalancedCandidate } from '../detection/candidates.js';

interface BookingFacts {
  readonly booking_id: string;
  readonly guest_name: string;
  readonly channel_code: string;
  readonly status: string;
  readonly check_in: Date;
  readonly check_out: Date;
  readonly adults: number;
  readonly children: number;
  readonly paid_amount: bigint;
  readonly deposit_amount: bigint;
  readonly total_amount: bigint;
}

export interface CaseHistorySource {
  readonly detected_at: Date;
  readonly escalated_at: Date | null;
  readonly resolved_at: Date | null;
  readonly resolved_by: string | null;
  readonly delay_reason: string | null;
}

export interface CaseHistoryEvent {
  readonly at: string;
  readonly action: 'DETECTED' | 'ESCALATED' | 'RESOLVED';
  readonly actorId: string | null;
  readonly note: string | null;
}

export function historyOf(row: CaseHistorySource): CaseHistoryEvent[] {
  const events: CaseHistoryEvent[] = [
    { at: row.detected_at.toISOString(), action: 'DETECTED', actorId: null, note: null },
  ];
  if (row.escalated_at !== null)
    events.push({
      at: row.escalated_at.toISOString(),
      action: 'ESCALATED',
      actorId: null,
      note: row.delay_reason,
    });
  if (row.resolved_at !== null)
    events.push({
      at: row.resolved_at.toISOString(),
      action: 'RESOLVED',
      actorId: row.resolved_by,
      note: null,
    });
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export async function detailCandidates(db: PrismaClient, candidates: readonly BalancedCandidate[]) {
  if (candidates.length === 0) return [];
  const ids = [...new Set(candidates.map((item) => item.bookingId))];
  const rows = await db.$queryRaw<BookingFacts[]>`
    SELECT b.id AS booking_id, g.full_name AS guest_name, c.code AS channel_code, b.status,
           b.check_in, b.check_out, b.adults, b.children,
           b.paid_amount, b.deposit_amount, b.total_amount
      FROM bookings b
      JOIN guests g ON g.id = b.guest_id
      JOIN channels c ON c.id = b.channel_id
     WHERE b.id = ANY(${ids}::uuid[])`;
  const byId = new Map(rows.map((row) => [row.booking_id, row]));
  return candidates.flatMap((candidate, index) => {
    const row = byId.get(candidate.bookingId);
    if (row === undefined) return [];
    const checkIn = businessDate(row.check_in);
    const checkOut = businessDate(row.check_out);
    return [
      {
        ...candidate,
        rank: index + 1,
        guestNameMasked: maskedName(row.guest_name),
        channelCode: row.channel_code,
        status: row.status,
        checkIn,
        checkOut,
        nights: nightsBetween(checkIn, checkOut),
        adults: row.adults,
        children: row.children,
        paidAmount: money(row.paid_amount),
        depositAmount: money(row.deposit_amount),
        totalAmount: money(row.total_amount),
      },
    ];
  });
}
