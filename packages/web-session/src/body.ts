/**
 * Đọc thân JSON của lệnh phiên và lệnh tài khoản khách (HB-324): giới hạn kích thước, lỗi gì cũng quy về
 * `InvalidInput` (400). Không ghi log thân lệnh: thân có thể chứa mật khẩu hoặc token.
 */
export class InvalidInput extends Error {}

const BODY_LIMIT = 16384;

export async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.body) throw new InvalidInput();
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) throw new InvalidInput();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value;
  } catch {
    throw new InvalidInput();
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** Bản sao nông của một object JSON; mảng, `null` hay giá trị nguyên thuỷ là thân sai. */
export function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new InvalidInput();
  return { ...value };
}
