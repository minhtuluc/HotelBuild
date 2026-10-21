import { describe, expect, it } from 'vitest';
import { withOutboxTrace } from '../../src/infrastructure/prisma/outbox-trace.extension.js';
import {
  DEFAULT_SAMPLE_RATIO,
  isPaymentPath,
  traceIdSamples,
} from '../../src/infrastructure/tracing/sampling.js';
import {
  currentTraceFields,
  currentTraceId,
  currentTraceparent,
  newTrace,
  parseTraceparent,
  runWithTrace,
  traceparentOf,
} from '../../src/infrastructure/tracing/trace-context.js';
import { envelopeOf } from '../../../worker/src/jobs/outbox-relay/envelope.js';
import { resolveTrace, traceFromPayload } from '../../../worker/src/tracing/trace-context.js';

const INCOMING = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const INCOMING_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('W3C traceparent (HB-181 AC1)', () => {
  it('giữ nguyên trace/span id và cờ sampled của khách', () => {
    const parsed = parseTraceparent(INCOMING);
    expect(parsed).toMatchObject({ traceId: INCOMING_TRACE_ID, sampled: true });
    expect(parsed === null ? null : traceparentOf(parsed)).toBe(INCOMING);
  });

  it('từ chối header sai định dạng hoặc id toàn số 0', () => {
    for (const value of [
      undefined,
      '',
      'không-phải-traceparent',
      `00-${'0'.repeat(32)}-00f067aa0ba902b7-01`,
      `00-4bf92f3577b34da6a3ce929d0e0e4736-${'0'.repeat(16)}-01`,
      '4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    ]) {
      expect(parseTraceparent(value)).toBeNull();
    }
  });

  it('mã tự sinh tròn 32/16 ký tự hex và đi qua AsyncLocalStorage', () => {
    const trace = newTrace('cid-1', true);
    expect(trace.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(trace.spanId).toMatch(/^[0-9a-f]{16}$/);
    const seen = runWithTrace(trace, () => ({
      traceId: currentTraceId(),
      traceparent: currentTraceparent(),
    }));
    expect(seen.traceId).toBe(trace.traceId);
    expect(seen.traceparent).toBe(traceparentOf(trace));
    expect(currentTraceparent()).toBeNull();
  });
});

describe('chính sách lấy mẫu (HB-181 AC1)', () => {
  it('mặc định 10% và luôn ≥ 10%', () => {
    expect(DEFAULT_SAMPLE_RATIO).toBe(0.1);
    let kept = 0;
    const total = 4000;
    for (let index = 0; index < total; index += 1) {
      if (traceIdSamples(newTrace('probe', true).traceId, DEFAULT_SAMPLE_RATIO)) kept += 1;
    }
    expect(kept / total).toBeGreaterThan(0.08);
    expect(kept / total).toBeLessThan(0.12);
  });

  it('quyết định theo traceId nên cùng trace luôn cùng kết quả', () => {
    const traceId = newTrace('probe', true).traceId;
    expect(traceIdSamples(traceId, 0.1)).toBe(traceIdSamples(traceId, 0.1));
    expect(traceIdSamples(traceId, 1)).toBe(true);
  });

  it('nhận diện đường dẫn tiền tệ, không nhận đường dẫn khác', () => {
    expect(isPaymentPath('/api/v1/payments/online?x=1')).toBe(true);
    expect(isPaymentPath('/api/v1/integrations/psp/vnpay/callback')).toBe(true);
    expect(isPaymentPath('/api/v1/refund-requests/abc/approve')).toBe(true);
    expect(isPaymentPath('/api/v1/bookings/abc')).toBe(false);
    expect(isPaymentPath('/api/v1/payments-history')).toBe(false);
  });
});

describe('API → outbox → job worker (HB-181 AC1)', () => {
  const trace = newTrace('cid-outbox', true);
  const payload = runWithTrace(trace, () =>
    withOutboxTrace({ operation: 'BOOKING_CREATED' }, currentTraceFields()),
  );
  const row = {
    id: '11111111-1111-4111-8111-111111111111',
    event_type: 'InventoryChanged',
    aggregate_type: 'Booking',
    aggregate_id: '22222222-2222-4222-8222-222222222222',
    channel_id: null,
    payload_json: payload,
    created_at: new Date('2026-10-21T00:00:00Z'),
  };
  const envelope = envelopeOf(row);

  it('ghi traceparent + correlationId của request vào payload outbox', () => {
    expect(payload).toMatchObject({
      traceparent: traceparentOf(trace),
      correlationId: 'cid-outbox',
    });
    expect(envelope.traceparent).toBe(traceparentOf(trace));
    expect(envelope.correlationId).toBe('cid-outbox');
  });

  it('job/consumer ở worker nối tiếp đúng trace và mã tương quan của sự kiện', () => {
    const fromEnvelope = resolveTrace(envelope.traceparent, envelope.correlationId);
    expect(fromEnvelope.traceId).toBe(trace.traceId);
    expect(fromEnvelope.correlationId).toBe('cid-outbox');
    const fromJobData = traceFromPayload({
      traceparent: envelope.traceparent,
      correlationId: envelope.correlationId,
    });
    expect(fromJobData?.traceId).toBe(trace.traceId);
    expect(fromJobData?.correlationId).toBe('cid-outbox');
  });

  it('lượt thử lại dùng lại dữ liệu job nên vẫn cùng trace', () => {
    const data = {
      operationId: '33333333-3333-4333-8333-333333333333',
      traceparent: traceparentOf(trace),
    };
    expect(traceFromPayload(data)?.traceId).toBe(traceFromPayload(data)?.traceId);
    expect(traceFromPayload(data)?.traceId).toBe(trace.traceId);
  });

  it('không thêm trace khi ngoài request hoặc payload đã có mã', () => {
    const fields = { traceparent: traceparentOf(trace), correlationId: trace.correlationId };
    const untouched = withOutboxTrace({ operation: 'X' }, null);
    expect(untouched).toStrictEqual({ operation: 'X' });
    const existing = withOutboxTrace(
      { traceparent: '00-giu-nguyen', correlationId: 'cid-giu' },
      fields,
    );
    expect(existing).toStrictEqual({ traceparent: '00-giu-nguyen', correlationId: 'cid-giu' });
    expect(withOutboxTrace('primitive', fields)).toBe('primitive');
  });

  it('payload mảng không bị chèn khoá lạ', () => {
    const array = withOutboxTrace([{ a: 1 }], {
      traceparent: traceparentOf(trace),
      correlationId: trace.correlationId,
    });
    expect(array).toStrictEqual([{ a: 1 }]);
  });
});
