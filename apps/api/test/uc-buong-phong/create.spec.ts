/**
 * HB-207 — `POST /housekeeping/tasks`: ghi nhận nhiệm vụ dọn / biên bản đã kiểm cho phòng chưa có bằng
 * chứng sẵn sàng của lượt giải phóng (BR-FO-07). Mỗi ca dùng ngày `fresh` (không có nhiệm vụ nào do
 * fixture dựng) trừ ca kiểm "đã có nhiệm vụ".
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, test } from 'vitest';
import { housekeepingTaskSchema } from '@pinehill/contracts';
import { clock, date, http, login, ownTask, rows, roomId, userId } from './fixture.js';
import { otherRoomId, room2Id } from '../room-blocks/inventory-seed.js';

const fresh = '2026-11-03';
const PATH = '/api/v1/housekeeping/tasks';

const create = (
  token: string,
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
) => {
  const request = http().post(PATH).set('Authorization', `Bearer ${token}`);
  if (key !== null) request.set('Idempotency-Key', key);
  return request.send(body);
};
const body = (over: Record<string, unknown> = {}) => ({
  roomId,
  businessDate: fresh,
  status: 'INSPECTED',
  reason: 'Kiểm phòng lần đầu',
  ...over,
});
const taskRows = (room: string, businessDate = fresh) =>
  rows(
    'SELECT id,status,version,assigned_to,note,completed_at FROM housekeeping_tasks WHERE room_id=$1 AND business_date=$2',
    [room, businessDate],
  );
const auditRows = (action: string) =>
  rows(
    'SELECT actor_id,entity_id,before_json,after_json,reason FROM audit_logs WHERE action=$1 ORDER BY chain_seq',
    [action],
  );
/** `audit_logs` là append-only nên không xoá giữa các ca: chỉ đếm dòng sinh ra từ đầu ca hiện tại. */
let auditBaseline = 0;
beforeEach(async () => {
  auditBaseline = (await auditRows('HOUSEKEEPING_TASK_CREATED')).length;
});
const audits = async () => (await auditRows('HOUSEKEEPING_TASK_CREATED')).slice(auditBaseline);
const code = (response: { body: unknown }) =>
  typeof response.body === 'object' && response.body !== null && 'code' in response.body
    ? response.body.code
    : undefined;

test('FRONT_DESK tạo nhiệm vụ PENDING: 201, ETag, audit cùng giao dịch, không gán người', async () => {
  const token = await login('FRONT_DESK');
  const response = await create(token, body({ status: 'PENDING', note: 'Dọn trước giờ nhận' }));
  expect(response.status).toBe(201);
  const task = housekeepingTaskSchema.parse(response.body);
  expect(task).toMatchObject({
    roomId,
    businessDate: fresh,
    status: 'PENDING',
    assignedTo: null,
    completedAt: null,
    version: 1,
    note: 'Dọn trước giờ nhận',
  });
  expect(response.headers.etag).toBe('"1"');
  expect(response.headers['access-control-expose-headers']).toBe('ETag');
  expect(await taskRows(roomId)).toHaveLength(1);
  const [audit] = await audits();
  expect(audit).toMatchObject({
    actor_id: userId,
    entity_id: task.id,
    before_json: null,
    after_json: { status: 'PENDING', version: 1 },
    reason: 'Kiểm phòng lần đầu',
  });
});

test('MANAGER ghi nhận INSPECTED: đóng dấu thời điểm kiểm theo đồng hồ máy chủ', async () => {
  const response = await create(await login('MANAGER'), body());
  expect(response.status).toBe(201);
  expect(housekeepingTaskSchema.parse(response.body)).toMatchObject({
    status: 'INSPECTED',
    completedAt: clock.now().toISOString(),
  });
});

test('replay cùng Idempotency-Key trả đúng kết quả cũ, không thêm dòng hay audit', async () => {
  const token = await login('FRONT_DESK'),
    key = randomUUID();
  const first = await create(token, body(), key);
  const replay = await create(token, body(), key);
  expect(first.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect(replay.headers.etag).toBe('"1"');
  expect(replay.body).toEqual(first.body);
  expect(await taskRows(roomId)).toHaveLength(1);
  expect(await audits()).toHaveLength(1);
});

test.each(['HOUSEKEEPING', 'RESERVATION_AGENT', 'ACCOUNTANT'])(
  'vai trò %s không được tạo nhiệm vụ',
  async (role) => {
    const response = await create(await login(role), body());
    expect(response.status).toBe(403);
    expect(await taskRows(roomId)).toHaveLength(0);
  },
);

test('phòng ngoài phạm vi ⇒ 403, không tồn tại ⇒ 404, không ACTIVE ⇒ 409; không dòng nào được tạo', async () => {
  const token = await login('FRONT_DESK');
  const outside = await create(token, body({ roomId: otherRoomId }));
  expect(outside.status).toBe(403);
  const missing = await create(token, body({ roomId: randomUUID() }));
  expect(missing.status).toBe(404);
  await rows("UPDATE rooms SET status='MAINTENANCE' WHERE id=$1", [room2Id]);
  try {
    const inactive = await create(token, body({ roomId: room2Id }));
    expect(inactive.status).toBe(409);
    expect(code(inactive)).toBe('E_FO_TASK_TRANSITION_NOT_ALLOWED');
  } finally {
    await rows("UPDATE rooms SET status='ACTIVE' WHERE id=$1", [room2Id]);
  }
  expect(await taskRows(otherRoomId)).toHaveLength(0);
  expect(await taskRows(room2Id)).toHaveLength(0);
  expect(await audits()).toHaveLength(0);
});

test.each(['PENDING', 'IN_PROGRESS', 'DONE', 'INSPECTED'])(
  'đã có nhiệm vụ %s cho (phòng, ngày) ⇒ 409, dòng cũ không đổi',
  async (status) => {
    await rows('UPDATE housekeeping_tasks SET status=$2 WHERE id=$1', [ownTask, status]);
    const before = await taskRows(roomId, date);
    const response = await create(await login('FRONT_DESK'), body({ businessDate: date }));
    expect(response.status).toBe(409);
    expect(code(response)).toBe('E_FO_TASK_TRANSITION_NOT_ALLOWED');
    expect(await taskRows(roomId, date)).toEqual(before);
    expect(await audits()).toHaveLength(0);
  },
);

test('hai lệnh tạo đồng thời cùng (phòng, ngày) với khoá khác nhau: đúng một thành công', async () => {
  const token = await login('FRONT_DESK');
  const results = await Promise.all([
    create(token, body({ roomId: room2Id })),
    create(token, body({ roomId: room2Id })),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  expect(await taskRows(room2Id)).toHaveLength(1);
  expect(await audits()).toHaveLength(1);
});

test.each([
  ['thiếu lý do', { reason: undefined }],
  ['lý do rỗng', { reason: '' }],
  ['trạng thái DONE không được phép', { status: 'DONE' }],
  ['trạng thái IN_PROGRESS không được phép', { status: 'IN_PROGRESS' }],
  ['ngày không tồn tại', { businessDate: '2026-02-30' }],
  ['roomId không phải UUID', { roomId: 'not-a-uuid' }],
  ['trường lạ (assignedTo)', { assignedTo: randomUUID() }],
])('thân lệnh không hợp lệ (%s) ⇒ 400, không ghi gì', async (_label, patch) => {
  const response = await create(await login('FRONT_DESK'), body(patch));
  expect(response.status).toBe(400);
  expect(await taskRows(roomId)).toHaveLength(0);
  expect(await audits()).toHaveLength(0);
});

test('thiếu Idempotency-Key bị từ chối trước khi ghi', async () => {
  const response = await create(await login('FRONT_DESK'), body(), null);
  expect(response.status).toBe(400);
  expect(await taskRows(roomId)).toHaveLength(0);
});

test('ghi chú và lý do che số giấy tờ/điện thoại trước khi lưu (NFR-SEC-03)', async () => {
  const response = await create(
    await login('FRONT_DESK'),
    body({ note: 'CCCD: 012345678901', reason: 'Khách gọi +84912345678 xin dọn sớm' }),
  );
  expect(response.status).toBe(201);
  const [row] = await taskRows(roomId);
  expect(String(row!.note)).not.toContain('012345678901');
  const [audit] = await audits();
  expect(String(audit!.reason)).not.toContain('912345678');
  expect(JSON.stringify(audit!.after_json)).not.toContain('012345678901');
});
