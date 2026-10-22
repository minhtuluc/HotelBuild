/**
 * Đọc/ghi SCR-15 qua `@pinehill/api-client` và `@pinehill/contracts` (không thêm endpoint).
 * `PUT /users/{id}/access` chưa có hàm trong `api-client` nên gọi qua `client.request` (như web desk với
 * `/payments`). Màn gọi thẳng API với bearer của phiên nhân viên, như bàn tiền sảnh (HB-152).
 */
import {
  ApiClient,
  ApiError,
  createPropertyApi,
  createUsersApi,
  type ApiResponse,
} from '@pinehill/api-client';
import {
  createUserRequestSchema,
  userAccessUpdateRequestSchema,
  userMeSchema,
  userSummarySchema,
} from '@pinehill/contracts';
import { createSessionClient } from '@pinehill/web-session/client';
import { UsersController, type PropertyOption, type UsersPorts } from './controller';

type RemotePorts = Pick<
  UsersPorts,
  'actor' | 'properties' | 'list' | 'create' | 'updateAccess' | 'deletePin'
>;

const data = <T>(response: ApiResponse<T>): T => response.data;

export function usersPorts(client: ApiClient): RemotePorts {
  const users = createUsersApi(client);
  const properties = createPropertyApi(client);
  return {
    actor: async () =>
      data(await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema })),
    properties: async (): Promise<readonly PropertyOption[]> => {
      const page = data(await properties.list());
      if (page.meta.hasMore)
        throw new ApiError({ kind: 'protocol', message: 'Incomplete properties' });
      return page.data.map(({ id, name }) => ({ id, name }));
    },
    list: async (query) => data(await users.list(query)),
    create: async (body, key) =>
      data(
        await client.request({
          method: 'POST',
          path: '/users',
          body: createUserRequestSchema.parse(body),
          idempotencyKey: key,
          decoder: userSummarySchema,
          maxAttempts: 1,
        }),
      ),
    updateAccess: async (userId, body, ifMatch, key) =>
      data(
        await client.request({
          method: 'PUT',
          path: `/users/${encodeURIComponent(userId)}/access`,
          body: userAccessUpdateRequestSchema.parse(body),
          ifMatch,
          idempotencyKey: key,
          decoder: userSummarySchema,
          maxAttempts: 1,
        }),
      ),
    deletePin: async (userId) => {
      await users.deletePin(userId);
    },
  };
}

/** Phiên nhân viên + bộ điều khiển; `dispose` ngừng refresh và bỏ mọi phản hồi đang bay. */
export function createUsersWorkspace(baseUrl: string) {
  let active = true;
  const session = createSessionClient({ kind: 'staff', onExpired: () => controller.expire() });
  const client = new ApiClient({
    baseUrl,
    maxAttempts: 1,
    getAccessToken: async () => (active ? await session.getAccessToken() : null),
  });
  const controller = new UsersController({
    ...usersPorts(client),
    random: (size) => crypto.getRandomValues(new Uint8Array(size)),
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
  });
  return {
    controller,
    dispose: () => {
      active = false;
      controller.dispose();
      session.dispose();
    },
  };
}
