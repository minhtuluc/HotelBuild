import type { IncomingMessage } from 'node:http';
import type { IdGenerator } from '@pinehill/domain';
import { CORRELATION_ID_PATTERN } from '../../common/request-id.js';
import { isPaymentPath, traceIdSamples } from './sampling.js';
import { TRACEPARENT_HEADER, newTrace, parseTraceparent, traceparentOf } from './trace-context.js';
import type { TraceContext } from './trace-context.js';

export interface RequestTraceOptions {
  readonly ids: IdGenerator;
  readonly sampleRatio: number;
}

/**
 * Ngữ cảnh trace của **một** request HTTP: giữ `traceparent` khách gửi, sinh mới khi thiếu, và ghi lại
 * vào header của chính request.
 *
 * Middleware `pino-http` chạy trước interceptor nên đây là nơi **duy nhất** sinh mã: dòng log đầu tiên và
 * span đều đọc lại cùng header, không phụ thuộc thứ tự khởi tạo. Mã tương quan cũng được chuẩn hoá ở đây
 * (giữ `X-Correlation-Id` hợp lệ của khách) để mọi dòng log đều có nó, kể cả request bị guard từ chối.
 */
export function ensureRequestTrace(
  request: IncomingMessage,
  options: RequestTraceOptions,
): TraceContext {
  const headers = request.headers;
  const incoming = headers['x-correlation-id'];
  const correlationId =
    typeof incoming === 'string' && CORRELATION_ID_PATTERN.test(incoming)
      ? incoming
      : options.ids.generate();
  headers['x-correlation-id'] = correlationId;

  const parsed = parseTraceparent(headers[TRACEPARENT_HEADER]);
  if (parsed !== null) return { ...parsed, correlationId };

  const trace = newTrace(correlationId, false);
  // Thanh toán luôn được giữ; lưu lượng thường theo tỉ lệ cấu hình (NFR-OBS-03).
  const context = {
    ...trace,
    sampled: isPaymentPath(request.url ?? '') || traceIdSamples(trace.traceId, options.sampleRatio),
  };
  headers[TRACEPARENT_HEADER] = traceparentOf(context);
  return context;
}
