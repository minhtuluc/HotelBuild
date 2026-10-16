/**
 * Dựng đầu vào engine huỷ `@pinehill/domain/cancellation` (HB-053) và đọc kết quả của nó.
 * Không có công thức tiền nào ở đây: bậc, hoàn, phạt và phân bổ đều do engine trả.
 */
import {
  allocatePayment,
  calculateCancellation,
  type AllocatedPayment,
  type CancellationDecision,
} from '@pinehill/domain/cancellation';
import { DomainError } from '@pinehill/domain';
import { notAllowed } from './validation.js';
import type { CancelDecision, CancelFacts, DecisionInput, TierInput } from './context.js';

interface EngineCommon {
  rooms: { bookingRoomId: string; firstNightPrice: number }[];
  cancelledRoomIds: string[];
  processedRoomIds: string[];
  payments: AllocatedPayment[];
}
type PolicyResult = CancellationDecision;
interface TierList {
  offsetHours: number;
  refundPercent: number;
  chargeFirstNight: boolean;
}
interface Outcome {
  readonly refundBase: bigint;
  readonly tierId: string | null;
  readonly token: string;
  readonly refundPercent: number;
  readonly requested: bigint;
  readonly penalty: bigint;
  readonly fee: bigint;
  readonly payments: readonly AllocatedPayment[];
}

export function decide(facts: CancelFacts, input: DecisionInput, nowMs: number): CancelDecision {
  const selected = selectRooms(facts, input.selected);
  const common = engineInput(facts, selected);
  const hours = (facts.checkInMs - nowMs) / 3_600_000;
  const outcome =
    input.state === 'CONFIRMED'
      ? policyOutcome(facts, common, input.forceMajeure, nowMs)
      : preconfirmationOutcome(facts, common, input.state, nowMs);
  return finish(hours, facts, outcome, selected);
}

/** Chỉ BookingRoom ACTIVE chưa từng bị huỷ (BR-CANCEL-19). */
function selectRooms(facts: CancelFacts, requested: readonly string[]): string[] {
  const selected = [...new Set(requested)].sort();
  if (!selected.length) throw notAllowed('Chưa chọn phòng nào để huỷ.');
  const byId = new Map(facts.rooms.map((room) => [room.roomId, room]));
  for (const id of selected) {
    const room = byId.get(id);
    if (!room) throw notAllowed('Phòng huỷ không thuộc booking.');
    if (!room.active) throw notAllowed('Phòng đã huỷ trước đó.');
  }
  return selected;
}

const forceMajeureTiers: TierList[] = [
  { offsetHours: -1, refundPercent: 100, chargeFirstNight: false },
];

function tierList(tiers: readonly TierInput[]): TierList[] {
  return tiers.map((tier) => ({
    offsetHours: tier.offsetHours,
    refundPercent: tier.refundPercent,
    chargeFirstNight: tier.chargeFirstNight,
  }));
}

function engineInput(facts: CancelFacts, selected: readonly string[]): EngineCommon {
  const byId = new Map(facts.rooms.map((room) => [room.roomId, room]));
  const roomIds = [...byId.keys()].sort();
  const processed = facts.rooms
    .filter((room) => !room.active)
    .map((room) => room.roomId)
    .sort();
  const payments = facts.receipts.map((receipt) => ({
    ...allocatePayment({
      paymentId: receipt.id,
      amount: Number(receipt.amount),
      weights: roomIds.map((roomId) => ({
        bookingRoomId: roomId,
        weight: Number(byId.get(roomId)!.weight),
      })),
    }),
    processedRoomIds: processed,
  }));
  return {
    rooms: facts.rooms.map((room) => ({
      bookingRoomId: room.roomId,
      firstNightPrice: Number(room.firstNight),
    })),
    cancelledRoomIds: [...selected],
    processedRoomIds: processed,
    payments,
  };
}

/**
 * BR-CANCEL-13: bất khả kháng hoàn 100% cơ sở, miễn phạt/phí, không theo bậc chính sách.
 * Bậc "bắt tất" 100% chỉ thay bảng bậc; mọi con số khác vẫn do engine trả.
 */
function policyOutcome(
  facts: CancelFacts,
  common: EngineCommon,
  forceMajeure: boolean,
  nowMs: number,
): Outcome {
  const result = runPolicy(facts, common, forceMajeure, nowMs);
  const applied = forceMajeure ? null : requireTier(facts, result);
  return shapePolicy(result, applied, forceMajeure, facts.fee);
}

function runPolicy(
  facts: CancelFacts,
  common: EngineCommon,
  forceMajeure: boolean,
  nowMs: number,
): PolicyResult {
  const tiers = forceMajeure ? forceMajeureTiers : tierList(facts.policy.tiers);
  const result = calculateCancellation({
    ...common,
    state: 'CONFIRMED',
    policy: { tiers },
    checkInDateTime: facts.checkInMs,
    now: nowMs,
  });
  if (result.refundMode !== 'POLICY')
    throw notAllowed('Engine chính sách huỷ trả sai chế độ hoàn.');
  return result;
}

function requireTier(facts: CancelFacts, result: PolicyResult): TierInput {
  const applied = appliedTier(facts, result);
  if (!applied) throw notAllowed('Bậc áp dụng không còn trong snapshot.');
  return applied;
}

function shapePolicy(
  result: PolicyResult,
  applied: TierInput | null,
  forceMajeure: boolean,
  fee: bigint,
): Outcome {
  return {
    refundBase: BigInt(result.refundBase),
    tierId: applied?.id ?? null,
    token: applied?.id ?? 'FORCE_MAJEURE',
    refundPercent: applied?.refundPercent ?? 100,
    requested: BigInt(forceMajeure ? result.refundBase : result.refundAmount),
    penalty: BigInt(result.penaltyAmount),
    fee: forceMajeure ? 0n : fee,
    payments: result.payments,
  };
}

function appliedTier(
  facts: CancelFacts,
  result: { tier: { offsetHours: number; refundPercent: number; chargeFirstNight: boolean } },
): TierInput | undefined {
  return facts.policy.tiers.find(
    (tier) =>
      tier.offsetHours === result.tier.offsetHours &&
      tier.refundPercent === result.tier.refundPercent &&
      tier.chargeFirstNight === result.tier.chargeFirstNight,
  );
}

function preconfirmationOutcome(
  facts: CancelFacts,
  common: EngineCommon,
  state: 'HELD' | 'PENDING_PAYMENT',
  nowMs: number,
): Outcome {
  const result = calculateCancellation({
    ...common,
    state,
    // Nhánh chưa xác nhận không đọc bậc; engine yêu cầu trường để giữ một hợp đồng gọi (BR-BOOK-18).
    policy: { tiers: tierList(facts.policy.tiers) },
    checkInDateTime: facts.checkInMs,
    now: nowMs,
  });
  if (result.refundMode !== 'PRECONFIRMATION')
    throw notAllowed('Engine chưa-xác-nhận trả sai chế độ hoàn.');
  return {
    refundBase: BigInt(result.refundBase),
    tierId: null,
    token: 'PRECONFIRMATION',
    refundPercent: 100,
    requested: BigInt(result.refundAmount),
    penalty: 0n,
    fee: 0n,
    payments: result.payments,
  };
}

function finish(
  hours: number,
  facts: CancelFacts,
  outcome: Outcome,
  selected: readonly string[],
): CancelDecision {
  const net = outcome.requested > outcome.fee ? outcome.requested - outcome.fee : 0n;
  const chosen = new Set(selected);
  const shares = outcome.payments.map((payment) => ({
    paymentId: payment.paymentId,
    share: payment.allocations
      .filter((allocation) => chosen.has(allocation.bookingRoomId))
      .reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n),
  }));
  const base = shares.reduce((sum, leg) => sum + leg.share, 0n);
  if (base !== outcome.refundBase)
    throw new DomainError('E_CANCEL_INVALID_INPUT', 'Allocation differs from decision');
  return {
    hours,
    tierId: outcome.tierId,
    token: outcome.token,
    policyId: facts.policy.id,
    refundPercent: outcome.refundPercent,
    base,
    requested: outcome.requested,
    penalty: outcome.penalty,
    fee: outcome.fee,
    net,
    legs: distribute(net, shares),
  };
}

/** Net chia theo tỷ lệ cơ sở từng nguồn, phần dư cho paymentId tăng dần (như `allocatePayment`). */
function distribute(
  net: bigint,
  shares: readonly { paymentId: string; share: bigint }[],
): { paymentId: string; amount: bigint }[] {
  if (net === 0n) return [];
  const total = shares.reduce((sum, leg) => sum + leg.share, 0n);
  if (total <= 0n) throw new DomainError('E_CANCEL_INVALID_INPUT', 'Refund needs a base');
  const ordered = [...shares].sort((left, right) => (left.paymentId < right.paymentId ? -1 : 1));
  const legs = ordered.map((leg) => ({
    paymentId: leg.paymentId,
    share: leg.share,
    amount: (net * leg.share) / total,
  }));
  let rest = net - legs.reduce((sum, leg) => sum + leg.amount, 0n);
  for (const leg of legs) {
    if (rest <= 0n) break;
    if (leg.amount >= leg.share) continue;
    leg.amount += 1n;
    rest -= 1n;
  }
  if (rest !== 0n) throw new DomainError('E_CANCEL_INVALID_INPUT', 'Refund legs mismatch');
  return legs
    .filter((leg) => leg.amount > 0n)
    .map((leg) => ({ paymentId: leg.paymentId, amount: leg.amount }));
}
