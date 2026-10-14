import { beforeAll } from 'vitest';
import {
  rows,
  propertyId,
  otherPropertyId,
  userId,
  secondUserId,
} from '../idempotency/database.js';

export {
  db,
  rows,
  clock,
  ids,
  propertyId,
  otherPropertyId,
  userId,
  secondUserId,
} from '../idempotency/database.js';

/**
 * Dữ liệu tổng hợp cho 6 báo cáo REP (HB-162). Mọi con số dưới đây được **tính tay** trong
 * `reads.spec.ts`, nên chỉ đổi khi sửa cả hai nơi:
 *
 * | Ngày | Khả dụng (đơn vị) | Đã bán | Doanh thu thuần |
 * | --- | --- | --- | --- |
 * | 2026-11-01 | 8 (R1+R2 + D1 6 giường) | 2 (B1, B3) | 1.270.000 |
 * | 2026-11-02 | 7 (R2 bị khoá) | 2 (B1, B2) | 1.656.000 |
 * | 2026-11-03 | 8 | 1 (B2) | 656.000 |
 */
export const stay = { from: '2026-11-01', to: '2026-11-04' };
/** Kỳ rộng hơn để bắt cả booking huỷ (ngày nghiệp vụ VN của `created_at`/`cancelled_at`). */
export const wide = { from: '2026-11-01', to: '2026-12-01' };

export let typeId = '',
  dormTypeId = '',
  otherTypeId = '',
  room1Id = '',
  room2Id = '',
  dormRoomId = '',
  otherRoomId = '',
  policyId = '',
  tier24Id = '',
  ratePlanId = '',
  ratePlan2Id = '',
  guestId = '';
export let booking1 = '',
  booking2 = '',
  booking3 = '',
  booking4 = '',
  booking5 = '',
  booking7 = '',
  bookingB = '',
  room1 = '',
  room2 = '',
  room3 = '',
  roomB = '',
  mergeId = '',
  moveId = '',
  caseId = '',
  caseDormId = '';
export const channels = new Map<string, string>();

async function insert(sql: string, values: unknown[] = []): Promise<string> {
  return String((await rows(sql, values))[0]!.id);
}

export interface BookingSeed {
  readonly code: string;
  readonly property: string;
  readonly type: string;
  readonly channel: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly status: string;
  readonly createdOn: string;
  readonly cancelledAt?: string;
  readonly cancelReason?: string;
  readonly note?: string;
  readonly totalAmount: number;
  /** Mỗi dòng phòng-đêm kèm hoa hồng của chính đêm đó (csdl §3.6: `nights[]` trong `payload_json`). */
  readonly nights: readonly {
    readonly day: string;
    readonly amount: number;
    readonly commission: number;
  }[];
  /** Gói giá khác FLEX7 cho ca lọc theo `ratePlanCode`. */
  readonly otherRatePlan?: boolean;
}

async function addBooking(seed: BookingSeed): Promise<{ booking: string; room: string }> {
  const booking = await insert(
    `INSERT INTO bookings(code,guest_id,property_id,room_type_id,rate_plan_id,channel_id,check_in,check_out,
                          adults,deposit_percent,status,note,total_amount,cancelled_at,cancel_reason,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,30,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [
      seed.code,
      guestId,
      seed.property,
      seed.type,
      seed.otherRatePlan === true ? ratePlan2Id : ratePlanId,
      channels.get(seed.channel)!,
      seed.checkIn,
      seed.checkOut,
      seed.status,
      seed.note ?? null,
      seed.totalAmount,
      seed.cancelledAt ?? null,
      seed.cancelReason ?? null,
      seed.createdOn,
    ],
  );
  const room = await insert(
    'INSERT INTO booking_rooms(booking_id,room_type_id,adults,price_per_night) VALUES($1,$2,2,$3) RETURNING id',
    [booking, seed.type, seed.nights[0]!.amount],
  );
  for (const night of seed.nights) {
    await rows(
      `INSERT INTO booking_charges(booking_id,booking_room_id,stay_date,kind,source_key,amount)
       VALUES($1,$2,$3,'ROOM',$4,$5)`,
      [booking, room, night.day, `stay:${night.day}`, night.amount],
    );
  }
  // `gross_amount`/`commission_amount` của snapshot là tổng của `nights[]` (csdl §3.6), nên dựng payload
  // từ đúng các dòng đêm rồi cộng lại — không nhập tay hai nguồn số khác nhau.
  const nights = seed.nights.map((night) => ({
    bookingRoomId: room,
    date: night.day,
    grossAmount: night.amount,
    commissionAmount: night.commission,
  }));
  const gross = nights.reduce((total, night) => total + night.grossAmount, 0);
  const commission = nights.reduce((total, night) => total + night.commissionAmount, 0);
  await rows(
    `INSERT INTO price_snapshots(booking_id,seq,payload_json,gross_amount,commission_amount,policy_snapshot_json,engine_version,captured_at)
     VALUES($1,1,jsonb_build_object('schemaVersion',1,'nights',$2::jsonb),$3,$4,'{}'::jsonb,'test-1',$5)`,
    [booking, JSON.stringify(nights), gross, commission, seed.createdOn],
  );
  return { booking, room };
}

beforeAll(async () => {
  policyId = await insert(
    "INSERT INTO cancellation_policies(code,name) VALUES('HB162','Synthetic HB-162') RETURNING id",
  );
  tier24Id = await insert(
    "INSERT INTO cancellation_tiers(policy_id,offset_hours,refund_percent,charge_first_night,label,sort_order) VALUES($1,24,50,false,'Trước 24 giờ',1) RETURNING id",
    [policyId],
  );
  ratePlanId = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('FLEX7','Linh hoạt 7 ngày',30,$1) RETURNING id",
    [policyId],
  );
  ratePlan2Id = await insert(
    "INSERT INTO rate_plans(code,name,deposit_percent,cancellation_policy_id) VALUES('SAVER3','Tiết kiệm 3 ngày',30,$1) RETURNING id",
    [policyId],
  );
  guestId = await insert(
    "INSERT INTO guests(full_name,phone) VALUES('Khách tổng hợp','+84900000162') RETURNING id",
  );
  for (const code of ['WEB', 'OTA_BOOKING', 'AGENCY', 'WALKIN', 'PHONE'])
    channels.set(
      code,
      await insert('INSERT INTO channels(code,name,multiplier) VALUES($1,$1,1) RETURNING id', [
        code,
      ]),
    );
  for (const [property, code, shared] of [
    [propertyId, 'STD', false],
    [propertyId, 'DOR', true],
    [otherPropertyId, 'STD', false],
  ] as const) {
    const type = await insert(
      'INSERT INTO room_types(property_id,code,name,capacity_adults,base_price,min_price,max_price,allow_shared) VALUES($1,$2,$2,2,1000000,500000,2000000,$3) RETURNING id',
      [property, code, shared],
    );
    if (property !== propertyId) otherTypeId = type;
    else if (shared) dormTypeId = type;
    else typeId = type;
  }
  for (const [property, type, code, beds] of [
    [propertyId, typeId, 'R1', 1],
    [propertyId, typeId, 'R2', 1],
    [propertyId, dormTypeId, 'D1', 6],
    [otherPropertyId, otherTypeId, 'R1', 1],
  ] as const) {
    const room = await insert(
      'INSERT INTO rooms(property_id,room_type_id,code,name,bed_count) VALUES($1,$2,$3,$3,$4) RETURNING id',
      [property, type, code, beds],
    );
    if (property !== propertyId) otherRoomId = room;
    else if (type === dormTypeId) dormRoomId = room;
    else if (code === 'R1') room1Id = room;
    else room2Id = room;
  }
  // Khoá R2 đúng một đêm để mẫu số công suất đổi theo ngày (BR-REP-01: đã trừ RoomBlock).
  await rows(
    "INSERT INTO room_blocks(room_id,start_date,end_date,reason,created_by) VALUES($1,'2026-11-02','2026-11-03','MAINTENANCE',$2)",
    [room2Id, userId],
  );

  const first = await addBooking({
    code: 'PH-261101-REP01',
    property: propertyId,
    type: typeId,
    channel: 'WEB',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    status: 'CONFIRMED',
    createdOn: '2026-11-10T08:00:00+07:00',
    totalAmount: 2_000_000,
    nights: [
      { day: '2026-11-01', amount: 1_000_000, commission: 0 },
      { day: '2026-11-02', amount: 1_000_000, commission: 0 },
    ],
  });
  booking1 = first.booking;
  room1 = first.room;

  const second = await addBooking({
    code: 'PH-261102-REP02',
    property: propertyId,
    type: typeId,
    channel: 'OTA_BOOKING',
    checkIn: '2026-11-02',
    checkOut: '2026-11-04',
    status: 'CONFIRMED',
    createdOn: '2026-11-10T09:00:00+07:00',
    totalAmount: 1_600_000,
    // Hoa hồng **khác nhau theo đêm** để bắt lỗi phân bổ theo tỷ lệ gộp của cả booking.
    nights: [
      { day: '2026-11-02', amount: 800_000, commission: 100_000 },
      { day: '2026-11-03', amount: 800_000, commission: 188_000 },
    ],
  });
  booking2 = second.booking;
  room2 = second.room;

  const third = await addBooking({
    code: 'PH-261103-REP03',
    property: propertyId,
    type: dormTypeId,
    channel: 'AGENCY',
    checkIn: '2026-11-01',
    checkOut: '2026-11-02',
    status: 'CHECKED_OUT',
    createdOn: '2026-11-11T08:00:00+07:00',
    totalAmount: 300_000,
    nights: [{ day: '2026-11-01', amount: 300_000, commission: 30_000 }],
  });
  booking3 = third.booking;
  room3 = third.room;

  const cancelled = await addBooking({
    code: 'PH-261104-REP04',
    property: propertyId,
    type: typeId,
    channel: 'WEB',
    checkIn: '2026-11-05',
    checkOut: '2026-11-07',
    status: 'CANCELLED',
    createdOn: '2026-11-12T08:00:00+07:00',
    cancelledAt: '2026-11-16T09:00:00+07:00',
    cancelReason: 'GUEST_REQUEST',
    totalAmount: 1_000_000,
    nights: [{ day: '2026-11-05', amount: 1_000_000, commission: 0 }],
  });
  booking4 = cancelled.booking;

  const forceMajeure = await addBooking({
    code: 'PH-261105-REP05',
    property: propertyId,
    type: typeId,
    channel: 'WEB',
    checkIn: '2026-11-06',
    checkOut: '2026-11-08',
    status: 'CANCELLED',
    createdOn: '2026-11-13T08:00:00+07:00',
    cancelledAt: '2026-11-20T08:00:00+07:00',
    cancelReason: 'FORCE_MAJEURE',
    note: 'Bão lũ miền Trung',
    totalAmount: 1_400_000,
    nights: [{ day: '2026-11-06', amount: 1_400_000, commission: 0 }],
  });
  booking5 = forceMajeure.booking;

  // Gói giá khác FLEX7, kỳ ở ngoài khoảng báo cáo công suất → chỉ tác động mẫu số tỷ lệ huỷ.
  const otherPlan = await addBooking({
    code: 'PH-261107-REP07',
    property: propertyId,
    type: typeId,
    channel: 'WEB',
    checkIn: '2026-11-20',
    checkOut: '2026-11-22',
    status: 'CONFIRMED',
    createdOn: '2026-11-18T08:00:00+07:00',
    totalAmount: 1_400_000,
    otherRatePlan: true,
    nights: [
      { day: '2026-11-20', amount: 700_000, commission: 0 },
      { day: '2026-11-21', amount: 700_000, commission: 0 },
    ],
  });
  booking7 = otherPlan.booking;

  const other = await addBooking({
    code: 'PH-261106-REP06',
    property: otherPropertyId,
    type: otherTypeId,
    channel: 'PHONE',
    checkIn: '2026-11-01',
    checkOut: '2026-11-02',
    status: 'CONFIRMED',
    createdOn: '2026-11-10T10:00:00+07:00',
    totalAmount: 900_000,
    nights: [{ day: '2026-11-01', amount: 900_000, commission: 0 }],
  });
  bookingB = other.booking;
  roomB = other.room;

  // Hoàn theo bậc chính sách: yêu cầu PENDING → người duyệt độc lập (maker-checker) → APPROVED.
  const refund = await insert(
    `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,applied_tier_id,refund_percent,
                                 requested_amount,status,reason,requester_type,requester_id,requested_by)
     VALUES($1,'evt-rep-04',$2,40,$3,50,600000,'PENDING','GUEST_REQUEST','USER',$4::text,$5::uuid) RETURNING id`,
    [booking4, policyId, tier24Id, userId, userId],
  );
  await rows('UPDATE users SET role=$1 WHERE id=$2', ['MANAGER', secondUserId]);
  await rows(
    `INSERT INTO refund_approvals(refund_request_id,request_version,approver_id,approver_role,decision,
                                  approved_amount,refund_fee,reason)
     VALUES($1,1,$2,'MANAGER','APPROVED',500000,0,'Duyệt theo bậc 24 giờ')`,
    [refund, secondUserId],
  );
  await rows(
    `UPDATE refund_requests SET status='APPROVED',approved_amount=500000,approved_by=$2::uuid,decided_at=$3 WHERE id=$1`,
    [refund, secondUserId, '2026-11-16T09:30:00+07:00'],
  );

  // Bất khả kháng: hoàn 100%, vào báo cáo riêng (BR-CANCEL-13).
  const forceRefund = await insert(
    `INSERT INTO refund_requests(booking_id,event_key,policy_id,hours_before_check_in,refund_percent,
                                 requested_amount,status,reason,is_force_majeure,
                                 requester_type,requester_id,requested_by)
     VALUES($1,'evt-rep-05',$2,72,100,1200000,'PENDING','FORCE_MAJEURE',true,'USER',$3::text,$4::uuid) RETURNING id`,
    [booking5, policyId, userId, userId],
  );
  await rows(
    `INSERT INTO refund_approvals(refund_request_id,request_version,approver_id,approver_role,decision,
                                  approved_amount,refund_fee,reason)
     VALUES($1,1,$2,'MANAGER','APPROVED',1200000,0,'Bất khả kháng — hoàn 100%')`,
    [forceRefund, secondUserId],
  );
  await rows(
    `UPDATE refund_requests SET status='APPROVED',approved_amount=1200000,approved_by=$2::uuid,decided_at=$3 WHERE id=$1`,
    [forceRefund, secondUserId, '2026-11-20T09:00:00+07:00'],
  );

  caseId = await insert(
    `INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status,detected_at)
     VALUES($1,'2026-11-02',$2,1,'OPEN','2026-11-01T22:00:00+07:00') RETURNING id`,
    [propertyId, typeId],
  );
  // Ca thứ hai cùng ngày nhưng **khác loại phòng**: không được nhận chi phí của ca loại STD.
  caseDormId = await insert(
    `INSERT INTO overbooking_cases(property_id,date,room_type_id,shortage_count,status,detected_at)
     VALUES($1,'2026-11-02',$2,1,'PROPOSED','2026-11-01T23:00:00+07:00') RETURNING id`,
    [propertyId, dormTypeId],
  );
  mergeId = await insert(
    `INSERT INTO room_merges(primary_booking_id,secondary_booking_id,room_id,move_type,consent_primary,consent_secondary,
                             discount_pct,discount_amount,approved_by,status)
     VALUES($1,$2,$3,'MERGE_SHARE',true,true,15,150000,$4,'ACTIVE') RETURNING id`,
    [booking1, booking2, room1Id, userId],
  );
  moveId = await insert(
    `INSERT INTO room_moves(booking_id,booking_room_id,move_type,reason,compensation_amount,transport_cost,status,
                            from_room_id,approved_by,walk_out_doc_no)
     VALUES($1,$2,'WALK_OUT','Quá tải tại cơ sở',$3,$4,'EXECUTED',$5,$6,'WO-162-0001') RETURNING id`,
    [booking2, room2, 700_000, 200_000, room2Id, userId],
  );
}, 60000);
