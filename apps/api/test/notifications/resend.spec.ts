import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { errorBodySchema, notificationSummarySchema } from '@pinehill/contracts';
import {
  clock,
  gateway,
  http,
  login,
  notificationJobs,
  resendNotification,
  randomUUID,
  rows,
  seedNotification,
  bookingId,
  otherBookingId,
  userId,
  NOTIFICATION_MAX_RESENDS,
} from './fixture.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Lượt gửi gần nhất là lúc gieo hàng ⇒ đẩy đồng hồ qua 5 phút rồi mới gửi lại lần đầu. */
function allowFirstResend() {
  clock.value += FIVE_MINUTES_MS;
}

const resendAuditSchema = z.object({
  action: z.string(),
  actor_id: z.string(),
  actor_role: z.string(),
  reason: z.string(),
});

/** Đọc `notificationId` từ dữ liệu job BullMQ mà không cần ép kiểu (`as`). */
function jobNotificationId(job: { readonly data: unknown }): string | undefined {
  const { data } = job;
  if (typeof data !== 'object' || data === null || !('notificationId' in data)) return undefined;
  const { notificationId } = data;
  return typeof notificationId === 'string' ? notificationId : undefined;
}

async function resends(notificationId: string): Promise<z.infer<typeof resendAuditSchema>[]> {
  return z
    .array(resendAuditSchema)
    .parse(
      await rows(
        "SELECT action,actor_id,actor_role,reason FROM audit_logs WHERE entity_id=$1 AND action='NOTIFICATION_RESEND_REQUESTED' ORDER BY at",
        [notificationId],
      ),
    );
}

/**
 * HB-168 · POST /notifications/{id}/resend (UC-NOTI-02): lý do bắt buộc; tối đa 3 lượt cách
 * nhau ≥ 5 phút theo máy chủ; mỗi lượt phát job `q.notification-send` + ghi audit người/lý do.
 */
describe('HB-168 · resend lần 1–3 thành công, lần 4 bị chặn', () => {
  test('ba lượt gửi lại mở chu kỳ mới, phát job và ghi audit; lượt bốn ⇒ 400', async () => {
    const id = await seedNotification({ status: 'SENT', sentAt: new Date() });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // Mỗi lượt đẩy đồng hồ qua 5 phút nên đăng nhập lại để token còn hạn (access 15 phút).
      allowFirstResend();
      const token = await login('FRONT_DESK');
      const response = await resendNotification(token, id, {
        reason: `Khách xin gửi lại lần ${attempt}`,
      });
      expect(response.status, `lượt ${attempt}`).toBe(200);
      const body = notificationSummarySchema.parse(response.body);
      expect(body).toMatchObject({
        id,
        bookingId,
        status: 'PENDING',
        retryCount: 0,
        sentAt: null,
        errorMessage: null,
      });
    }
    allowFirstResend();
    const blocked = await resendNotification(await login('FRONT_DESK'), id, {
      reason: 'Khách xin gửi lại lần 4',
    });
    expect(blocked.status).toBe(400);
    expect(errorBodySchema.parse(blocked.body).code).toBe('E_GEN_VALIDATION_FAILED');

    const audit = await resends(id);
    expect(audit).toHaveLength(3);
    expect(audit[0]).toMatchObject({ actor_id: userId, actor_role: 'FRONT_DESK' });
    expect(audit.map((row) => row.reason)).toEqual([
      'Khách xin gửi lại lần 1',
      'Khách xin gửi lại lần 2',
      'Khách xin gửi lại lần 3',
    ]);

    const jobs = (await notificationJobs()).filter((job) => jobNotificationId(job) === id);
    expect(jobs).toHaveLength(3);
    for (const job of jobs) {
      expect(job.name).toBe('notification-send');
      // Số lượt BullMQ thử = số lượt gửi thật: worker đánh `FAILED` ở lượt thứ ba thất bại
      // (`retry_count` chạm `NOTIFICATION_MAX_RESENDS`), lượt thứ tư chỉ gặp hàng `FAILED` rồi thoát.
      expect(job.opts.attempts).toBe(NOTIFICATION_MAX_RESENDS);
      expect(job.opts.backoff).toMatchObject({ type: 'fixed', delay: FIVE_MINUTES_MS });
    }
  });
});

describe('HB-168 · resend chặn khi chưa đủ 5 phút', () => {
  test('hàng mới gieo và lượt vừa gửi đều ⇒ 429 E_GEN_RATE_LIMITED kèm thời gian chờ', async () => {
    const id = await seedNotification();
    const token = await login('FRONT_DESK');
    const early = await resendNotification(token, id, { reason: 'Gửi ngay' });
    expect(early.status).toBe(429);
    const body = errorBodySchema.parse(early.body);
    expect(body.code).toBe('E_GEN_RATE_LIMITED');
    expect(body.retryAfterSeconds).toBeGreaterThan(200);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(300);
    expect(early.headers['retry-after']).toBe(String(body.retryAfterSeconds));
    expect((await resends(id)).length).toBe(0);

    allowFirstResend();
    expect((await resendNotification(token, id, { reason: 'Đã đủ 5 phút' })).status).toBe(200);
    // Lượt vừa gửi đặt `updated_at` về giờ thật ⇒ đưa đồng hồ giả về giờ thật để bắt đúng 429.
    clock.value = Date.now();
    const again = await resendNotification(token, id, { reason: 'Ngay sau lượt vừa gửi' });
    expect(again.status).toBe(429);
    expect(errorBodySchema.parse(again.body).retryAfterSeconds).toBeGreaterThan(290);
  });
});

describe('HB-168 · resend kiểm đầu vào + tồn tại', () => {
  test('thiếu/trống lý do ⇒ 400; id sai định dạng ⇒ 400; id lạ ⇒ 404 E_GEN_NOT_FOUND', async () => {
    const id = await seedNotification();
    const token = await login('FRONT_DESK');
    const invalidBodies: object[] = [{}, { reason: '' }, { reason: 'ok', extra: 1 }];
    for (const body of invalidBodies) {
      const response = await resendNotification(token, id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    }
    const malformed = await resendNotification(token, 'not-a-uuid', { reason: 'Khách xin' });
    expect(malformed.status).toBe(400);
    const missing = await resendNotification(token, '00000000-0000-4000-8000-000000000000', {
      reason: 'Khách xin',
    });
    expect(missing.status).toBe(404);
    expect(errorBodySchema.parse(missing.body).code).toBe('E_GEN_NOT_FOUND');
  });

  test('bản ghi đã huỷ ⇒ 400, không phát job', async () => {
    const id = await seedNotification({ status: 'CANCELLED' });
    const token = await login('OWNER');
    allowFirstResend();
    const response = await resendNotification(token, id, { reason: 'Khách xin' });
    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    expect((await notificationJobs()).some((job) => jobNotificationId(job) === id)).toBe(false);
  });
});

describe('HB-168 · resend RBAC + phạm vi', () => {
  test('ACCOUNTANT/HOUSEKEEPING/SYSADMIN ⇒ 403 E_RBAC_FORBIDDEN', async () => {
    const id = await seedNotification();
    for (const role of ['ACCOUNTANT', 'HOUSEKEEPING', 'SYSADMIN'] as const) {
      const token = await login(role);
      allowFirstResend();
      const response = await resendNotification(token, id, { reason: 'Khách xin' });
      expect(response.status, role).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_RBAC_FORBIDDEN');
    }
    expect((await resends(id)).length).toBe(0);
  });

  test('ngoài phạm vi ⇒ 403 E_AUTH_OUT_OF_SCOPE; OWNER làm được trên mọi bản ghi', async () => {
    const outer = await seedNotification({ bookingId: otherBookingId });
    const orphan = await seedNotification({ bookingId: null });
    const token = await login('FRONT_DESK');
    allowFirstResend();
    for (const target of [outer, orphan]) {
      const response = await resendNotification(token, target, { reason: 'Khách xin' });
      expect(response.status, target).toBe(403);
      expect(errorBodySchema.parse(response.body).code).toBe('E_AUTH_OUT_OF_SCOPE');
    }
    const owner = await login('OWNER');
    allowFirstResend();
    expect((await resendNotification(owner, outer, { reason: 'QL gửi lại' })).status).toBe(200);
    allowFirstResend();
    expect((await resendNotification(owner, orphan, { reason: 'QL gửi lại' })).status).toBe(200);
    const audit = await resends(orphan);
    expect(audit[0]).toMatchObject({ actor_id: userId, actor_role: 'OWNER', reason: 'QL gửi lại' });
  });
});

describe('HB-168 · gateway.notify là điểm vào dùng chung sau commit', () => {
  test('ghi PENDING + phát job cùng payload cho luồng nghiệp vụ khác gọi', async () => {
    const id = await gateway().notify({
      bookingId,
      recipient: '+84916800002',
      channel: 'SMS',
      template: 'booking-confirmed',
      message: { guestName: 'Khách', bookingCode: 'HB168-X' },
    });
    const stored = await rows(
      'SELECT booking_id,status,retry_count,recipient,channel,template,payload_json FROM notifications WHERE id=$1::uuid',
      [id],
    );
    expect(stored[0]).toMatchObject({
      booking_id: bookingId,
      status: 'PENDING',
      retry_count: 0,
      recipient: '+84916800002',
      channel: 'SMS',
      template: 'booking-confirmed',
      payload_json: { guestName: 'Khách', bookingCode: 'HB168-X' },
    });
    const jobs = (await notificationJobs()).filter((job) => jobNotificationId(job) === id);
    expect(jobs).toHaveLength(1);
  });
});

/**
 * HB-168/HB-029 · gửi lại chống trùng (BR-GEN-08): cùng khoá + cùng thân lệnh phát lại kết quả đã
 * commit (kể cả khi đã quá mốc 5 phút, vì bản phát lại không chạy lại kiểm tra nghiệp vụ).
 */
describe('HB-168 · resend chống trùng theo khoá idempotency', () => {
  test('cùng khoá hai lần ⇒ cùng phản hồi, một bản ghi audit, một job', async () => {
    const id = await seedNotification({ status: 'SENT', sentAt: new Date() });
    allowFirstResend();
    const token = await login('FRONT_DESK');
    const key = randomUUID();
    const body = { reason: 'Khách xin gửi lại' };
    const first = await resendNotification(token, id, body, key);
    expect(first.status).toBe(200);
    // Không đẩy đồng hồ giữa hai lượt: nếu không phát lại thì lượt hai đã 429 vì chưa đủ 5 phút.
    const second = await resendNotification(token, id, body, key);
    expect(second.status).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(notificationSummarySchema.parse(second.body)).toEqual(
      notificationSummarySchema.parse(first.body),
    );
    expect(await resends(id)).toHaveLength(1);
    const jobs = (await notificationJobs()).filter((job) => jobNotificationId(job) === id);
    expect(jobs).toHaveLength(1);
  });

  test('cùng khoá nhưng lý do khác ⇒ 409 E_SYS_IDEMPOTENCY_KEY_REUSED, không thêm audit/job', async () => {
    const id = await seedNotification({ status: 'SENT', sentAt: new Date() });
    allowFirstResend();
    const token = await login('FRONT_DESK');
    const key = randomUUID();
    expect((await resendNotification(token, id, { reason: 'Khách xin gửi lại' }, key)).status).toBe(
      200,
    );
    const conflict = await resendNotification(token, id, { reason: 'Lý do khác' }, key);
    expect(conflict.status).toBe(409);
    expect(errorBodySchema.parse(conflict.body).code).toBe('E_SYS_IDEMPOTENCY_KEY_REUSED');
    expect(await resends(id)).toHaveLength(1);
  });

  test('thiếu Idempotency-Key ⇒ 400 E_GEN_VALIDATION_FAILED, chưa ghi gì', async () => {
    const id = await seedNotification({ status: 'SENT', sentAt: new Date() });
    allowFirstResend();
    const token = await login('FRONT_DESK');
    const response = await http()
      .post(`/api/v1/notifications/${id}/resend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Khách xin gửi lại' });
    expect(response.status).toBe(400);
    expect(errorBodySchema.parse(response.body).code).toBe('E_GEN_VALIDATION_FAILED');
    expect(await resends(id)).toHaveLength(0);
  });

  test('lý do tự do được che PII trước khi vào nhật ký kiểm toán', async () => {
    const id = await seedNotification({ status: 'SENT', sentAt: new Date() });
    allowFirstResend();
    const token = await login('FRONT_DESK');
    const reason = 'Khách 0912345678 xin gửi lại';
    expect((await resendNotification(token, id, { reason })).status).toBe(200);
    const audit = await resends(id);
    expect(audit).toHaveLength(1);
    // `audit_logs.reason` không được AuditWriter che (HB-009) nên chính tuyến phải che trước khi ghi.
    expect(audit[0]?.reason).toBe('Khách ****5678 xin gửi lại');
  });
});
