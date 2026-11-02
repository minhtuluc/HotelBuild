/**
 * Giữ **byte gốc** của webhook OTA trước khi Fastify parse JSON (HB-128; api.md §5.1).
 *
 * HMAC ký trên đúng các byte client gửi, nên không được ký lại `JSON.stringify(request.body)` (thứ tự
 * khoá/khoảng trắng có thể khác). `main.ts` cố ý **không** bật `@fastify/raw-body`; hook `preParsing`
 * ở đây là đường duy nhất giữ raw bytes cho cả production lẫn test, không phụ thuộc option chỉ có ở test.
 */
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Byte gốc của thân webhook OTA (chỉ có khi đi qua `registerOtaRawBody`). */
    chanRawBody?: Buffer;
  }
}

/** Chỉ đệm thân của tuyến tiếp nhận OTA; mọi request khác đi thẳng vào parser như cũ. */
const OTA_INGESTION_PATH = /\/integrations\/ota\/[^/]+\/bookings(?:\?|$)/;

export function registerOtaRawBody(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (request.method !== 'POST' || !OTA_INGESTION_PATH.test(request.url)) return payload;
    const raw = await buffer(payload);
    request.chanRawBody = raw;
    return Readable.from(raw);
  });
}
