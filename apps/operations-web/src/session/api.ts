/**
 * Lời gọi của SCR-14 qua BFF `/api/session/sys/**` bằng client phiên của `lib/ops-session.ts` (HB-201):
 * hồ sơ phiên, danh sách cơ sở để chọn và đổi mật khẩu. Không tự tính quyền; chỉ đọc số máy chủ trả.
 */
import { ApiClient, ApiError, isApiError } from '@pinehill/api-client';
import {
  changePasswordRequestSchema,
  listResponseSchema,
  propertySummarySchema,
  userMeSchema,
  type ChangePasswordRequest,
  type UserMe,
} from '@pinehill/contracts';
import type { PropertyOption } from './gate';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

export async function loadProfile(client: ApiClient): Promise<UserMe> {
  return (await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema })).data;
}

/** Đọc hết các trang; thiếu một trang là thất bại, không bao giờ trả danh sách cụt để chọn cơ sở. */
export async function loadProperties(client: ApiClient): Promise<PropertyOption[]> {
  const options: PropertyOption[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const page = (
      await client.request({
        method: 'GET',
        path: '/properties',
        query: { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
        decoder: listResponseSchema(propertySummarySchema),
      })
    ).data;
    options.push(...page.data.map(({ id, name }) => ({ id, name })));
    if (!page.meta.hasMore) return options;
    const next = page.meta.nextCursor;
    if (next === null || next === undefined || seen.has(next))
      throw new ApiError({ kind: 'protocol', message: 'Incomplete property projection' });
    seen.add(next);
    cursor = next;
  }
  throw new ApiError({ kind: 'protocol', message: 'Too many property pages' });
}

/**
 * Danh sách cơ sở **cho cổng**: chỉ tải khi cần chọn tên (OWNER thấy mọi cơ sở, hoặc nhiều cơ sở trong
 * phạm vi). Tải thất bại thì dùng `propertyScope` của máy chủ (tên = mã) thay vì chặn người dùng, trừ khi
 * không có phạm vi nào để dùng hoặc phiên đã hết hạn (401).
 */
export async function propertiesForGate(
  client: ApiClient,
  me: Pick<UserMe, 'role' | 'propertyScope' | 'mustChangePassword'>,
): Promise<PropertyOption[] | null> {
  if (me.mustChangePassword) return null;
  if (me.role !== 'OWNER' && me.propertyScope.length <= 1) return null;
  try {
    return await loadProperties(client);
  } catch (error) {
    if (me.propertyScope.length > 0 && !(isApiError(error) && error.status === 401)) return null;
    throw error;
  }
}

/** Một lần gửi duy nhất: gửi lại sau mất kết quả sẽ thất bại vì mật khẩu cũ có thể đã đổi. */
export async function changePassword(
  client: ApiClient,
  input: ChangePasswordRequest,
): Promise<void> {
  await client.requestVoid({
    method: 'POST',
    path: '/auth/change-password',
    headers: { 'x-session-request': '1' },
    body: changePasswordRequestSchema.parse(input),
    maxAttempts: 1,
  });
}
