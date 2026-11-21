import { expect, test } from 'vitest';
import { pruneErrorHeaders } from '../../src/common/idempotency/interceptor.js';

// Go-live: lệnh ghi lỗi (400/409/422…) từng mất cả header CORS do hook `onRequest` gắn, nên trình duyệt chặn
// phản hồi và màn vận hành gọi thẳng API chỉ thấy "chưa xác định kết quả".
test('lỗi trong lệnh idempotent giữ header CORS + Vary + X-Trace-Id, bỏ header do controller đặt', () => {
  const headers = new Map<string, string>([
    ['access-control-allow-origin', 'https://ops.example'],
    ['Access-Control-Expose-Headers', 'ETag, X-Trace-Id'],
    ['vary', 'Origin'],
    ['x-trace-id', 't-1'],
    ['location', '/secret'],
    ['content-type', 'application/json'],
    ['etag', '"1"'],
  ]);
  const reply = {
    getHeaders: () => Object.fromEntries(headers),
    removeHeader(name: string) {
      headers.delete(name);
      return reply;
    },
  };
  pruneErrorHeaders(reply);
  expect([...headers.keys()].sort()).toEqual([
    'Access-Control-Expose-Headers',
    'access-control-allow-origin',
    'vary',
    'x-trace-id',
  ]);
});
