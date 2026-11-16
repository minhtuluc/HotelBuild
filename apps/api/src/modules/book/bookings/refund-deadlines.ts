/**
 * HB-245 (yêu cầu frontend #7): mốc huỷ tuyệt đối cho báo giá và booking.
 *
 * Không có luật mới ở đây: bậc lấy từ chính sách (snapshot của booking, hoặc chính sách hiện hành của
 * gói giá khi báo giá), giờ nhận phòng quy đổi bằng **đúng** `nominalCheckInMs` mà lệnh huỷ dùng, và
 * ranh giới bậc do `refundDeadlines` của engine huỷ tính (cùng luật `resolveTier`). Nhờ vậy mốc hiển
 * thị không thể lệch với số tiền hoàn thực tế.
 */
import { z } from 'zod';
import { refundDeadlines } from '@pinehill/domain/cancellation';
import type { RefundDeadline } from '@pinehill/contracts';
import { nominalCheckInMs } from '../cancel/context.js';

/** BR-CHAN-04: booking OTA có mã chính sách kênh thì hoàn theo hợp đồng kênh, không theo bậc của ta. */
export const OTA_CHANNEL_CODES: readonly string[] = ['OTA_BOOKING', 'OTA_AGODA', 'OTA_AIRBNB'];

/** Trạng thái còn huỷ được bằng `POST /bookings/{id}/cancel`; trạng thái khác không có mốc. */
const CANCELLABLE: readonly string[] = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'];

export interface DeadlineTier {
  readonly offsetHours: number;
  readonly refundPercent: number;
  readonly chargeFirstNight: boolean;
}

export interface StayClock {
  readonly checkInTime: string;
  readonly timezone: string;
}

/** Bậc → mốc ISO UTC, xếp tăng dần; bậc bắt tất đứng cuối với `until: null`. */
export function deadlinesFor(
  tiers: readonly DeadlineTier[],
  checkIn: string,
  stay: StayClock,
): RefundDeadline[] {
  const checkInMs = nominalCheckInMs(checkIn, stay.checkInTime, stay.timezone);
  const policy = {
    tiers: tiers.map((tier) => ({
      offsetHours: tier.offsetHours,
      refundPercent: tier.refundPercent,
      chargeFirstNight: tier.chargeFirstNight,
    })),
  };
  return refundDeadlines(policy, checkInMs).map((deadline) => ({
    until: deadline.until === null ? null : new Date(deadline.until).toISOString(),
    refundPercent: deadline.tier.refundPercent,
    chargeFirstNight: deadline.tier.chargeFirstNight,
  }));
}

const snapshotSchema = z.object({
  policy: z.object({
    tiers: z
      .array(
        z.object({
          offsetHours: z.number().int(),
          refundPercent: z.number().int(),
          chargeFirstNight: z.boolean(),
        }),
      )
      .min(1),
  }),
  stay: z.object({ checkInTime: z.string().min(1), timezone: z.string().min(1) }),
});

export interface DeadlineFacts {
  readonly status: string;
  readonly checkIn: string;
  readonly channelCode: string;
  readonly channelPolicyCode: string | null;
  /** `price_snapshots` mới nhất: `policy_snapshot_json` (bậc) và `payload_json` (giờ nhận phòng). */
  readonly snapshot: { readonly policy: unknown; readonly payload: unknown } | undefined;
}

/**
 * Mốc của một booking, hoặc `undefined` khi không áp: hết huỷ được, OTA theo hợp đồng kênh, chưa có
 * snapshot, hoặc snapshot cũ/hỏng. Đọc **không bao giờ** hỏng vì mốc — lệnh huỷ mới là nơi báo lỗi.
 */
export function bookingDeadlines(facts: DeadlineFacts): RefundDeadline[] | undefined {
  if (!CANCELLABLE.includes(facts.status) || facts.snapshot === undefined) return undefined;
  if (OTA_CHANNEL_CODES.includes(facts.channelCode) && (facts.channelPolicyCode ?? '').length > 0)
    return undefined;
  const parsed = snapshotSchema.safeParse({
    policy: facts.snapshot.policy,
    stay: z.object({ stay: z.unknown() }).safeParse(facts.snapshot.payload).data?.stay,
  });
  if (!parsed.success) return undefined;
  try {
    return deadlinesFor(parsed.data.policy.tiers, facts.checkIn, parsed.data.stay);
  } catch {
    return undefined;
  }
}
