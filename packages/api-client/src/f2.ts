/**
 * Bề mặt F2 (HB-030): PROP, INV, SYS. Request đã parse theo schema `@pinehill/contracts`;
 * lệnh sửa đối tượng có version dùng `If-Match`, lệnh ghi giữ `Idempotency-Key` của client.
 */
import {
  allotmentPutRequestSchema,
  allotmentRowSchema,
  auditLogEntrySchema,
  availabilitySchema,
  inventoryGridSchema,
  listResponseSchema,
  operationRefSchema,
  operationStatusViewSchema,
  propertySummarySchema,
  propertyUpdateRequestSchema,
  roomBlockSchema,
  roomSummarySchema,
  roomTypeCreateRequestSchema,
  roomTypeSummarySchema,
  systemSettingSchema,
  systemSettingUpdateRequestSchema,
  backupRequestSchema,
  restoreRequestSchema,
  type AllotmentPutRequest,
  type AllotmentRow,
  type Availability,
  type AuditLogEntry,
  type BackupRequest,
  type InventoryGrid,
  type ListPage,
  type PropertySummary,
  type PropertyUpdateRequest,
  type RoomBlockCreateRequest,
  type RoomSummary,
  type RoomTypeCreateRequest,
  type RoomTypeSummary,
  type ConnectingRoomRequest,
  type OperationRef,
  type OperationStatusView,
  type RestoreRequest,
  type RoomBlock,
  type SystemSetting,
  type SystemSettingUpdateRequest,
} from '@pinehill/contracts';
import { ApiClient, type ApiResponse } from './client.js';

export interface PropertyApi {
  list(): Promise<ApiResponse<ListPage<PropertySummary>>>;
  update(
    propertyId: string,
    input: PropertyUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<PropertySummary>>;
  createRoomType(input: RoomTypeCreateRequest): Promise<ApiResponse<RoomTypeSummary>>;
  listRoomTypes(query?: { propertyId?: string }): Promise<ApiResponse<ListPage<RoomTypeSummary>>>;
  listRooms(query?: {
    propertyId?: string;
    roomTypeId?: string;
    status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  }): Promise<ApiResponse<ListPage<RoomSummary>>>;
  setConnectingRoom(
    roomId: string,
    input: ConnectingRoomRequest,
    ifMatch: string,
  ): Promise<ApiResponse<RoomSummary>>;
  listRoomBlocks(query?: {
    propertyId?: string;
    roomId?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<RoomBlock>>>;
  createRoomBlock(input: RoomBlockCreateRequest): Promise<ApiResponse<RoomBlock>>;
  deleteRoomBlock(roomBlockId: string, reason: string): Promise<ApiResponse<undefined>>;
}

export function createPropertyApi(client: ApiClient): PropertyApi {
  return {
    list: () =>
      client.request({
        method: 'GET',
        path: '/properties',
        decoder: listResponseSchema(propertySummarySchema),
      }),
    update: (propertyId, input, ifMatch) =>
      client.request({
        method: 'PATCH',
        path: `/properties/${encodeURIComponent(propertyId)}`,
        body: propertyUpdateRequestSchema.parse(input),
        ifMatch,
        decoder: propertySummarySchema,
      }),
    createRoomType: (input) =>
      client.request({
        method: 'POST',
        path: '/room-types',
        body: roomTypeCreateRequestSchema.parse(input),
        decoder: roomTypeSummarySchema,
      }),
    listRoomTypes: (query) =>
      client.request({
        method: 'GET',
        path: '/room-types',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(roomTypeSummarySchema),
      }),
    listRooms: (query) =>
      client.request({
        method: 'GET',
        path: '/rooms',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(roomSummarySchema),
      }),
    setConnectingRoom: (roomId, input, ifMatch) =>
      client.request({
        method: 'PUT',
        path: `/rooms/${encodeURIComponent(roomId)}/connecting-room`,
        body: input,
        ifMatch,
        decoder: roomSummarySchema,
      }),
    listRoomBlocks: (query) =>
      client.request({
        method: 'GET',
        path: '/room-blocks',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(roomBlockSchema),
      }),
    createRoomBlock: (input) =>
      client.request({
        method: 'POST',
        path: '/room-blocks',
        body: input,
        decoder: roomBlockSchema,
      }),
    deleteRoomBlock: (roomBlockId, reason) =>
      client.requestVoid({
        method: 'DELETE',
        path: `/room-blocks/${encodeURIComponent(roomBlockId)}`,
        query: { reason },
      }),
  };
}

export interface InventoryApi {
  grid(query: {
    propertyId: string;
    from: string;
    to: string;
    roomTypeId?: string;
    channelCode?: string;
  }): Promise<ApiResponse<InventoryGrid>>;
  availability(query: {
    propertyId: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    roomCount: number;
    roomTypeId?: string;
    channelCode?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<Availability>>;
  listAllotments(query: {
    channelId: string;
    roomTypeId: string;
    from: string;
    to: string;
  }): Promise<ApiResponse<ListPage<AllotmentRow>>>;
  putAllotments(input: AllotmentPutRequest, ifMatch: string): Promise<ApiResponse<undefined>>;
}

export function createInventoryApi(client: ApiClient): InventoryApi {
  return {
    grid: (query) =>
      client.request({
        method: 'GET',
        path: '/inventory/grid',
        query,
        decoder: inventoryGridSchema,
      }),
    availability: (query) =>
      client.request({
        method: 'GET',
        path: '/inventory/availability',
        query,
        decoder: availabilitySchema,
      }),
    listAllotments: (query) =>
      client.request({
        method: 'GET',
        path: '/channel-allotments',
        query,
        decoder: listResponseSchema(allotmentRowSchema),
      }),
    putAllotments: (input, ifMatch) =>
      client.requestVoid({
        method: 'PUT',
        path: '/channel-allotments',
        body: allotmentPutRequestSchema.parse(input),
        ifMatch,
      }),
  };
}

export interface SystemApi {
  listAuditLogs(query?: {
    entityType?: string;
    entityId?: string;
  }): Promise<ApiResponse<ListPage<AuditLogEntry>>>;
  listSettings(query?: {
    limit?: number;
    cursor?: string;
  }): Promise<ApiResponse<ListPage<SystemSetting>>>;
  updateSetting(
    key: string,
    input: SystemSettingUpdateRequest,
    ifMatch: string,
  ): Promise<ApiResponse<undefined>>;
  requestBackup(input: BackupRequest): Promise<ApiResponse<OperationRef>>;
  requestRestore(backupId: string, input: RestoreRequest): Promise<ApiResponse<OperationRef>>;
  operation(operationId: string): Promise<ApiResponse<OperationStatusView>>;
}

export function createSystemApi(client: ApiClient): SystemApi {
  return {
    listAuditLogs: (query) =>
      client.request({
        method: 'GET',
        path: '/audit-logs',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(auditLogEntrySchema),
      }),
    listSettings: (query) =>
      client.request({
        method: 'GET',
        path: '/system-settings',
        ...(query === undefined ? {} : { query }),
        decoder: listResponseSchema(systemSettingSchema),
      }),
    updateSetting: (key, input, ifMatch) =>
      client.requestVoid({
        method: 'PUT',
        path: `/system-settings/${encodeURIComponent(key)}`,
        body: systemSettingUpdateRequestSchema.parse(input),
        ifMatch,
      }),
    requestBackup: (input) =>
      client.request({
        method: 'POST',
        path: '/system/backups',
        body: backupRequestSchema.parse(input),
        decoder: operationRefSchema,
      }),
    requestRestore: (backupId, input) =>
      client.request({
        method: 'POST',
        path: `/system/backups/${encodeURIComponent(backupId)}/restore`,
        body: restoreRequestSchema.parse(input),
        decoder: operationRefSchema,
      }),
    operation: (operationId) =>
      client.request({
        method: 'GET',
        path: `/operations/${encodeURIComponent(operationId)}`,
        decoder: operationStatusViewSchema,
      }),
  };
}
