/**
 * Cơ sở phân bổ khoản thu theo trọng số phòng (HB-211; BR-CANCEL-19, BR-PAY-02) — **một công thức**
 * dùng chung cho mọi nơi ghi `payment_allocations` và cho engine huỷ:
 *
 * - `roomWeights`: trọng số của một phòng = `Σ booking_charges.amount` của phòng đó (nghĩa vụ
 *   phòng–đêm bất biến sau khuyến mãi). `book/cancel/context.ts` dùng đúng hàm này để dựng
 *   `refundBase`, nên hai phía không thể lệch công thức.
 * - `planReceiptAllocation`: chia số tiền thực nhận thành các dòng phân bổ. Phần theo phòng chia
 *   `floor(amount × w_i / Σw)`; phần dư VND (+1 cho từng phần) đi theo `id` tăng dần — đúng phép chia
 *   của `allocatePayment` (`@pinehill/domain/cancellation`) mà engine huỷ dùng. Trong một phòng, tiền
 *   được chia tiếp cho các dòng `booking_charges` theo nghĩa vụ còn lại, cùng quy tắc làm tròn, nhờ vậy
 *   `Σ` phần theo phòng luôn khớp chính xác phần của phòng.
 *
 * Vì sao phần dư đi theo `id` **tăng dần**: `calculateCancellation` tính lại phân bổ chuẩn từ
 * `(paymentId, amount, weights)` và từ chối mọi phân bổ khác (`Allocation differs from snapshot`).
 * Muốn `refundBase` (engine) và trần hoàn theo nguồn (sổ cái) đọc cùng một con số thì phép chia ở đây
 * phải trùng từng VND với hàm chuẩn đó — không được chia dư về phòng cuối.
 *
 * Khoản thu không vượt quá nghĩa vụ còn lại (mọi đường thu đều chặn như vậy); nếu dữ liệu cũ để lại
 * chênh lệch, phần vượt được giữ nguyên chưa phân bổ thay vì ghi quá nghĩa vụ của một dòng phí.
 */

/** Dòng `booking_charges` tối thiểu để tính trọng số phòng (khớp truy vấn của `cancel/context.ts`). */
export interface RoomChargeBasis {
  readonly booking_room_id: string | null;
  readonly stay_date: Date | null;
  readonly amount: bigint;
}

/** Trọng số từng phòng: tổng tiền các đêm của phòng; bỏ dòng thiếu phòng/ngày như context. */
export function roomWeights(charges: readonly RoomChargeBasis[]): Map<string, bigint> {
  const weights = new Map<string, bigint>();
  for (const charge of charges) {
    if (charge.booking_room_id === null || charge.stay_date === null) continue;
    weights.set(
      charge.booking_room_id,
      (weights.get(charge.booking_room_id) ?? 0n) + charge.amount,
    );
  }
  return weights;
}

export interface WeightedPart {
  readonly id: string;
  readonly weight: bigint;
}

export interface WeightedShare {
  readonly id: string;
  readonly amount: bigint;
}

/** `floor` từng phần rồi rải phần dư (+1) theo `id` tăng dần — bản `bigint` của `allocatePayment`. */
export function allocateByWeight(
  amount: bigint,
  parts: readonly WeightedPart[],
): readonly WeightedShare[] {
  if (amount <= 0n || parts.length === 0) return [];
  const ordered = [...parts].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const total = ordered.reduce((sum, part) => sum + part.weight, 0n);
  if (total <= 0n) return [];
  const shares = ordered.map((part) => ({ id: part.id, amount: (amount * part.weight) / total }));
  let remainder = amount - shares.reduce((sum, share) => sum + share.amount, 0n);
  for (const share of shares) {
    if (remainder <= 0n) break;
    share.amount += 1n;
    remainder -= 1n;
  }
  return shares;
}

/** Một dòng `booking_charges` còn nghĩa vụ để phân bổ. */
export interface ReceiptCharge {
  readonly id: string;
  readonly kind: string;
  readonly roomId: string | null;
  /** `booking_charges.amount` — cơ sở trọng số bất biến của phòng. */
  readonly weight: bigint;
  /** `amount − voided_amount − đã phân bổ còn hiệu lực`. */
  readonly outstanding: bigint;
}

export interface AllocationLine {
  readonly chargeId: string;
  readonly amount: bigint;
}

interface RoomGroup {
  readonly roomId: string;
  readonly weight: bigint;
  readonly charges: readonly ReceiptCharge[];
}

/**
 * Chia `amount` cho các phòng theo trọng số, **không vượt** nghĩa vụ còn lại của từng phòng: phần
 * vượt được chia lại cho các phòng còn dư địa theo đúng trọng số. Khi không phòng nào bị chặn, kết quả
 * trùng khít phép chia chuẩn (điều kiện thực tế của mọi khoản thu).
 */
function roomShares(amount: bigint, rooms: readonly RoomGroup[]): Map<string, bigint> {
  const shares = new Map<string, bigint>(rooms.map((room) => [room.roomId, 0n]));
  const capacity = new Map<string, bigint>(
    rooms.map((room) => [
      room.roomId,
      room.charges.reduce((sum, charge) => sum + charge.outstanding, 0n),
    ]),
  );
  let left = amount;
  let open = rooms.filter((room) => (capacity.get(room.roomId) ?? 0n) > 0n && room.weight > 0n);
  while (left > 0n && open.length) {
    const proposal = allocateByWeight(
      left,
      open.map((room) => ({ id: room.roomId, weight: room.weight })),
    );
    let excess = 0n;
    for (const part of proposal) {
      const roomId = part.id;
      const roomLeft = (capacity.get(roomId) ?? 0n) - (shares.get(roomId) ?? 0n);
      const take = part.amount < roomLeft ? part.amount : roomLeft;
      shares.set(roomId, (shares.get(roomId) ?? 0n) + take);
      excess += part.amount - take;
    }
    if (excess === 0n) break;
    left = excess;
    open = open.filter(
      (room) => (capacity.get(room.roomId) ?? 0n) > (shares.get(room.roomId) ?? 0n),
    );
  }
  return shares;
}

function groupRooms(charges: readonly ReceiptCharge[]): RoomGroup[] {
  const groups = new Map<string, { roomId: string; weight: bigint; charges: ReceiptCharge[] }>();
  for (const charge of charges) {
    // Dòng ROOM thiếu `booking_room_id` là dữ liệu hỏng: coi mỗi dòng là một "phòng" riêng để không
    // bỏ tiền, không đoán phòng.
    const roomId = charge.roomId ?? charge.id;
    const group = groups.get(roomId) ?? { roomId, weight: 0n, charges: [] };
    group.weight += charge.weight;
    group.charges.push(charge);
    groups.set(roomId, group);
  }
  return [...groups.values()].sort((left, right) =>
    left.roomId < right.roomId ? -1 : left.roomId > right.roomId ? 1 : 0,
  );
}

function weightedRoomCharges(amount: bigint, charges: readonly ReceiptCharge[]): AllocationLine[] {
  const rooms = groupRooms(charges);
  const shares = roomShares(amount, rooms);
  const lines: AllocationLine[] = [];
  for (const room of rooms) {
    const share = shares.get(room.roomId) ?? 0n;
    if (share <= 0n) continue;
    for (const part of allocateByWeight(
      share,
      room.charges
        .filter((charge) => charge.outstanding > 0n)
        .map((charge) => ({ id: charge.id, weight: charge.outstanding })),
    ))
      lines.push({ chargeId: part.id, amount: part.amount });
  }
  return lines;
}

/**
 * Kế hoạch phân bổ một khoản thu: lần lượt từng nhóm `kind` theo `order`; nhóm `ROOM` chia theo trọng
 * số phòng, các nhóm phí chia tuần tự theo `id` (thứ tự bất biến của BR-PAY-02).
 */
export function planReceiptAllocation(
  amount: bigint,
  charges: readonly ReceiptCharge[],
  order: readonly string[],
): readonly AllocationLine[] {
  const lines: AllocationLine[] = [];
  let remaining = amount;
  for (const kind of order) {
    if (remaining <= 0n) break;
    if (kind === 'ROOM') {
      // Trọng số phòng = Σ `amount` của **mọi** đêm trong phòng (kể cả đêm đã trả đủ/đã void), đúng
      // nguồn với `cancel/context.ts`; chỉ phần còn nghĩa vụ mới nhận tiền.
      const roomLines = weightedRoomCharges(
        remaining,
        charges.filter((charge) => charge.kind === kind),
      );
      lines.push(...roomLines);
      remaining -= roomLines.reduce((sum, line) => sum + line.amount, 0n);
      continue;
    }
    const candidates = charges
      .filter((charge) => charge.kind === kind && charge.outstanding > 0n)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    for (const charge of candidates) {
      if (remaining <= 0n) break;
      const take = remaining < charge.outstanding ? remaining : charge.outstanding;
      lines.push({ chargeId: charge.id, amount: take });
      remaining -= take;
    }
  }
  return lines;
}
