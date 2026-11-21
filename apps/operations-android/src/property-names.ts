/**
 * HB-264 — tên cơ sở cho màn "Chọn cơ sở" (SCR-56). `/auth/me` chỉ trả id trong `propertyScope`; tên lấy từ
 * danh sách công khai `GET /public/properties`. Lỗi tải tên không chặn đăng nhập: hiện id như cũ.
 */
import type { ApiClient } from '@pinehill/api-client';
import { listResponseSchema, propertyPublicSummarySchema } from '@pinehill/contracts';

export interface NamedProperty {
  readonly id: string;
  readonly name: string;
}

export async function loadPropertyNames(
  list: () => Promise<readonly NamedProperty[]>,
): Promise<ReadonlyMap<string, string>> {
  try {
    return new Map((await list()).map((property) => [property.id, property.name]));
  } catch {
    return new Map();
  }
}

export function propertyLabel(id: string, names: ReadonlyMap<string, string>): string {
  return names.get(id) ?? id;
}

/** Danh sách công khai qua client của phiên (tuyến `@Public`, không cần quyền riêng). */
export function publicPropertyList(client: ApiClient): () => Promise<readonly NamedProperty[]> {
  return async () =>
    (
      await client.request({
        method: 'GET',
        path: '/public/properties',
        decoder: listResponseSchema(propertyPublicSummarySchema),
      })
    ).data.data;
}
