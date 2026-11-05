/**
 * Cổng I/O của SCR-43: đọc cơ sở/loại phòng/ca quá tải và đóng ca qua BFF `/api/session/sys/**`, bằng
 * client HB-120 (`createOverbookingApi` đã nhận `idempotencyKey` + `etag` nên gửi lại đúng khoá cũ).
 */
import { createOverbookingApi, type ApiClient } from '@pinehill/api-client';
import {
  listResponseSchema,
  propertySummarySchema,
  roomTypeSummarySchema,
  userMeSchema,
  type OverbookingCaseList,
  type OverbookingResolveResponse,
  type PropertySummary,
  type RoomTypeSummary,
  type UserMe,
} from '@pinehill/contracts';
import { completeCatalogue } from '../../app/(ops)/admin-commands/catalogue';
import type { Filter, Intent } from './model';

export interface Actor {
  userId: string;
  role: UserMe['role'];
  propertyScope: readonly string[];
}

export interface CasePorts {
  actor(signal: AbortSignal): Promise<Actor>;
  catalogue(
    signal: AbortSignal,
  ): Promise<{ properties: PropertySummary[]; roomTypes: RoomTypeSummary[] }>;
  list(
    filter: Filter,
    cursor: string | undefined,
    signal: AbortSignal,
  ): Promise<OverbookingCaseList>;
  resolve(intent: Intent): Promise<OverbookingResolveResponse>;
}

const PAGE = 20;

/** Chỉ gửi bộ lọc có giá trị; không thêm tham số ngoài hợp đồng HB-120. */
export function listQuery(filter: Filter, cursor: string | undefined) {
  return {
    limit: PAGE,
    ...(cursor === undefined ? {} : { cursor }),
    ...(filter.propertyId === '' ? {} : { propertyId: filter.propertyId }),
    ...(filter.roomTypeId === '' ? {} : { roomTypeId: filter.roomTypeId }),
    ...(filter.status === null ? {} : { status: filter.status }),
    ...(filter.dateFrom === '' ? {} : { dateFrom: filter.dateFrom }),
    ...(filter.dateTo === '' ? {} : { dateTo: filter.dateTo }),
    ...(filter.overdueOnly ? { overdueOnly: true } : {}),
  };
}

export function createPorts(client: ApiClient): CasePorts {
  const api = createOverbookingApi(client);
  return {
    actor: async (signal) => {
      const me = (
        await client.request({ method: 'GET', path: '/auth/me', decoder: userMeSchema, signal })
      ).data;
      return { userId: me.userId, role: me.role, propertyScope: me.propertyScope };
    },
    catalogue: async (signal) => ({
      properties: await completeCatalogue(
        client,
        '/properties',
        listResponseSchema(propertySummarySchema),
        signal,
      ),
      roomTypes: await completeCatalogue(
        client,
        '/room-types',
        listResponseSchema(roomTypeSummarySchema),
        signal,
      ),
    }),
    list: async (filter, cursor) => (await api.listCases(listQuery(filter, cursor))).data,
    resolve: async (intent) =>
      (
        await api.resolveCase(intent.caseId, intent.body, {
          etag: intent.ifMatch,
          idempotencyKey: intent.key,
        })
      ).data,
  };
}
