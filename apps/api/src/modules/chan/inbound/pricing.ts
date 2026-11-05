/**
 * Đối chiếu **số tiền kênh đã bán** với giá hệ thống đang bán, và chốt giá trị bất biến cho snapshot.
 *
 * BR-RATE-17: không chép công thức giá vào use case. Dữ kiện nạp qua loader HB-056 rồi giao engine
 * `@pinehill/domain/pricing` — đúng đường mà `POST /quotes` (HB-074) đang chạy, nên một sự kiện OTA
 * chỉ "khớp" khi tổng tiền trùng **cùng con số** mà engine trả cho kênh/loại phòng/kỳ đó.
 *
 * Lệch giá, thiếu gói giá hoặc engine từ chối cấu hình ⇒ mã cách ly (AC11); không tự tính lại tiền,
 * không tự sửa `amount` của kênh.
 */
import type { Prisma } from '@prisma/client';
import { quotePrice } from '@pinehill/domain/pricing';
import { AppError } from '../../../common/app-error.js';
import { loadPricingFacts, type PricingFacts } from '../../rate/pricing-facts/loader.js';
import { OTA_CODE } from './codes.js';
import type { OtaPayload } from './payload.js';
import { failed, type OtaFailure, type OtaScope } from './scope.js';

export interface OtaPricing {
  /** Tổng tiền engine chốt cho `roomCount` đơn vị bán (VND nguyên). */
  readonly total: bigint;
  readonly ratePlanId: string;
  readonly depositPercent: number;
  /** `bookings.channel_policy_code`: dấu policy của kênh, dùng lại khi huỷ (BR-CHAN-04). */
  readonly channelPolicyCode: string;
  /** Giá **một** đơn vị bán cho từng đêm, theo thứ tự đêm của kỳ. */
  readonly nightlyPrices: readonly number[];
  readonly engineVersion: string;
}

type Tx = Prisma.TransactionClient;

export async function priceEvent(
  tx: Tx,
  scope: OtaScope,
  payload: OtaPayload,
): Promise<OtaPricing | OtaFailure> {
  let facts: PricingFacts;
  try {
    facts = await loadPricingFacts(tx, {
      propertyId: scope.propertyId,
      roomTypeId: scope.roomTypeId,
      checkIn: payload.checkIn,
      checkOut: payload.checkOut,
    });
  } catch (error) {
    // Chỉ lỗi cấu hình đã công bố mới là "cách ly"; lỗi CSDL phải rollback cả transaction (AC6).
    if (error instanceof AppError) return failed(OTA_CODE.pricingUnavailable);
    throw error;
  }
  const priced = quotePrice({
    ...facts,
    channelCode: payload.channelCode,
    units: payload.roomCount,
  });
  if (!priced.ok) return failed(OTA_CODE.pricingUnavailable);
  const total = BigInt(priced.value.total);
  if (total !== BigInt(payload.amount)) return failed(OTA_CODE.amountMismatch);
  const policy = await tx.rate_plans.findUnique({
    where: { id: priced.value.ratePlanId },
    select: { cancellation_policies: { select: { code: true } } },
  });
  const policyCode = policy?.cancellation_policies.code ?? null;
  return {
    total,
    ratePlanId: priced.value.ratePlanId,
    depositPercent: Number(facts.ratePlan.depositPercent),
    channelPolicyCode: policyCode === null ? 'OTA_CHANNEL' : `OTA-${policyCode}`,
    nightlyPrices: priced.value.nights.map((night) => night.nightlyPrice),
    engineVersion: priced.value.engineVersion,
  };
}
