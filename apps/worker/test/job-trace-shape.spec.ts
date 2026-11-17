/**
 * TD-32 — payload job do API đẩy mang thêm `traceparent`/`correlationId` (HB-181). Schema `strictObject` của
 * consumer phải nhận hai khoá này qua `jobTraceShape`, đồng thời vẫn chặn mọi khoá lạ khác.
 */
import { describe, expect, it } from 'vitest';
import { notificationSendPayloadSchema } from '../src/noti/payload.js';
import { jobTraceShape } from '../src/tracing/job-trace-shape.js';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const NOTIFICATION_ID = '0b9f1c52-8f0e-4c9a-9c55-3f0b6f6f1d10';

describe('jobTraceShape', () => {
  it('đúng hai khoá API gắn khi đẩy job', () => {
    expect(Object.keys(jobTraceShape).sort()).toEqual(['correlationId', 'traceparent']);
  });

  it('consumer nhận payload có trace và không có trace', () => {
    expect(
      notificationSendPayloadSchema.parse({
        notificationId: NOTIFICATION_ID,
        traceparent: TRACEPARENT,
        correlationId: 'corr-1',
      }),
    ).toEqual({
      notificationId: NOTIFICATION_ID,
      traceparent: TRACEPARENT,
      correlationId: 'corr-1',
    });
    expect(notificationSendPayloadSchema.parse({ notificationId: NOTIFICATION_ID })).toEqual({
      notificationId: NOTIFICATION_ID,
    });
  });

  it('vẫn từ chối khoá lạ khác', () => {
    expect(
      notificationSendPayloadSchema.safeParse({ notificationId: NOTIFICATION_ID, tracestate: 'x' })
        .success,
    ).toBe(false);
  });
});
