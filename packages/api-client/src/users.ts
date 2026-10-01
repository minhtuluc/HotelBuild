/**
 * Bề mặt người dùng nội bộ cho SCR-15 (QĐ-03 T6). `POST /users` và `DELETE …/pin`
 * không tự gửi lại (`maxAttempts: 1`) vì QĐ-03 T9 chưa có middleware idempotency.
 */
import {
  createUserRequestSchema,
  listResponseSchema,
  userSummarySchema,
  type CreateUserRequest,
  type ListPage,
  type UserSummary,
  type UsersQuery,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface UsersApi {
  list(query?: UsersQuery): Promise<ApiResponse<ListPage<UserSummary>>>;
  create(input: CreateUserRequest): Promise<ApiResponse<UserSummary>>;
  deletePin(userId: string): Promise<ApiResponse<undefined>>;
}

export function createUsersApi(client: ApiClient): UsersApi {
  return {
    list: (query) =>
      client.request({
        method: 'GET',
        path: '/users',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(userSummarySchema),
      }),
    create: (input) =>
      client.request({
        method: 'POST',
        path: '/users',
        body: createUserRequestSchema.parse(input),
        decoder: userSummarySchema,
        maxAttempts: 1,
      }),
    deletePin: (userId) =>
      client.requestVoid({
        method: 'DELETE',
        path: `/users/${encodeURIComponent(userId)}/pin`,
        maxAttempts: 1,
      }),
  };
}
