import { ApiClient, ApiError } from '@pinehill/api-client';
import {
  listResponseSchema,
  propertySummarySchema,
  propertyUpdateRequestSchema,
  roomTypeSummarySchema,
  roomTypeCreateRequestSchema,
  userMeSchema,
  roomSummarySchema,
  connectingRoomRequestSchema,
  type RoomSummary,
} from '@pinehill/contracts';
import { createSessionClient } from '@pinehill/web-session/client';
import { AdminController, type AdminPorts } from './controller';
import type { AdminScope, AdminCommand } from './intent';
import { completeCatalogue } from './catalogue';
import { readBlocks, writeBlock, isBlockCommand } from './blocks';
import { readAllotments, writeAllotments, type AllotmentSelection } from './allotment-api';
function assertConnectionReceipt(
  data: RoomSummary,
  command: Extract<AdminCommand, { kind: 'connecting-update' }>,
): void {
  if (
    data.id !== command.targetId ||
    data.connectingRoomId !== command.body.connectingRoomId ||
    !Number.isSafeInteger(data.version) ||
    BigInt(data.version) <= BigInt(command.tag.slice(1, -1))
  )
    throw new ApiError({ kind: 'protocol', message: 'Mismatched or stale connection receipt' });
}
export function adminPorts(
  client: ApiClient,
  scope: AdminScope,
  selection?: AllotmentSelection,
): AdminPorts {
  return {
    actor: async (signal) =>
      (
        await client.request({
          method: 'GET',
          path: '/auth/me',
          decoder: userMeSchema,
          signal,
          maxAttempts: 1,
        })
      ).data,
    read: async (signal, intent) => {
      if (scope === 'allotment') return readAllotments(client, signal, selection, intent);
      if (scope === 'room-block') return readBlocks(client, signal);
      const properties =
        scope === 'connecting'
          ? []
          : await completeCatalogue(
              client,
              '/properties',
              listResponseSchema(propertySummarySchema),
              signal,
            );
      const roomTypes =
        scope !== 'property'
          ? await completeCatalogue(
              client,
              '/room-types',
              listResponseSchema(roomTypeSummarySchema),
              signal,
            )
          : [];
      const rooms =
        scope === 'connecting'
          ? await completeCatalogue(client, '/rooms', listResponseSchema(roomSummarySchema), signal)
          : undefined;
      if (rooms?.some((room) => !Number.isSafeInteger(room.version)))
        throw new ApiError({ kind: 'protocol', message: 'Unsafe room version' });
      return { properties, roomTypes, ...(rooms ? { rooms } : {}) };
    },
    write: async (command, idempotencyKey, signal) => {
      const headers = { 'x-session-request': '1' };
      if (command.kind === 'allotment-put')
        return writeAllotments(client, command, idempotencyKey, signal);
      if (isBlockCommand(command)) return writeBlock(client, command, idempotencyKey, signal);
      if (command.kind === 'connecting-update') {
        const data = (
          await client.request({
            method: 'PUT',
            path: '/rooms/' + encodeURIComponent(command.targetId) + '/connecting-room',
            body: connectingRoomRequestSchema.parse(command.body),
            ifMatch: command.tag,
            idempotencyKey,
            headers,
            signal,
            maxAttempts: 1,
            decoder: roomSummarySchema,
          })
        ).data;
        assertConnectionReceipt(data, command);
        return { kind: 'connecting-update', data };
      }
      if (command.kind === 'property-update') {
        const data = (
          await client.request({
            method: 'PATCH',
            path: '/properties/' + encodeURIComponent(command.targetId),
            body: propertyUpdateRequestSchema.parse(command.body),
            ifMatch: command.tag,
            idempotencyKey,
            headers,
            signal,
            maxAttempts: 1,
            decoder: propertySummarySchema,
          })
        ).data;
        if (data.id !== command.targetId)
          throw new ApiError({ kind: 'protocol', message: 'Mismatched property receipt' });
        return { kind: 'property-update', data };
      }
      const data = (
        await client.request({
          method: 'POST',
          path: '/room-types',
          body: roomTypeCreateRequestSchema.parse(command.body),
          idempotencyKey,
          headers,
          signal,
          maxAttempts: 1,
          decoder: roomTypeSummarySchema,
        })
      ).data;
      if (data.propertyId !== command.body.propertyId || data.code !== command.body.code)
        throw new ApiError({ kind: 'protocol', message: 'Mismatched type receipt' });
      return { kind: 'room-type-create', data };
    },
  };
}
export function createAdminWorkspace(scope: AdminScope, selection?: AllotmentSelection) {
  let active = true,
    pinned: ApiClient | undefined,
    verified: string | undefined;
  const session = createSessionClient({
    kind: 'staff',
    onExpired: () => controller.deny('expired'),
    onSessionChanged: (token) => {
      if (verified && token !== verified) {
        verified = undefined;
        pinned = undefined;
        controller.invalidate();
        if (token) void controller.load();
        else controller.deny('expired');
      }
    },
  });
  const actor = async (signal: AbortSignal) => {
    const token = await session.getAccessToken();
    if (!active || !token) throw new ApiError({ kind: 'http', status: 401, message: 'Expired' });
    verified = token;
    pinned = new ApiClient({
      baseUrl: window.location.origin + '/api/session/sys',
      getAccessToken: async () => {
        const current = await session.getAccessToken();
        if (!active || current !== token)
          throw new ApiError({ kind: 'aborted', message: 'Session changed' });
        return token;
      },
      maxAttempts: 1,
    });
    return adminPorts(pinned, scope).actor(signal);
  };
  const current = () => {
    if (!pinned) throw new ApiError({ kind: 'aborted', message: 'Session changed' });
    return adminPorts(pinned, scope, selection);
  };
  const controller = new AdminController({
    scope,
    ports: {
      actor,
      read: (signal, intent) => current().read(signal, intent),
      write: (...args) => current().write(...args),
    },
    storage: {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: (key) => window.sessionStorage.removeItem(key),
    },
    createId: () => crypto.randomUUID(),
    now: Date.now,
  });
  return {
    controller,
    select: (next: AllotmentSelection) => {
      if (scope !== 'allotment' || !controller.resetRead()) return false;
      selection = next;
      void controller.load();
      return true;
    },
    dispose: () => {
      active = false;
      controller.dispose();
      session.dispose();
    },
  };
}
