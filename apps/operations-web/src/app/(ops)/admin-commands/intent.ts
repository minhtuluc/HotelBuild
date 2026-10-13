import {
  roomBlockCreateRequestSchema,
  roomBlockSchema,
  propertyUpdateRequestSchema,
  propertySummarySchema,
  roomSummarySchema,
  connectingRoomRequestSchema,
  roomTypeCreateRequestSchema,
  type RoomBlockCreateRequest,
  type PropertyUpdateRequest,
  type RoomTypeCreateRequest,
  type ConnectingRoomRequest,
} from '@pinehill/contracts';
export type AdminScope = 'property' | 'room-type' | 'connecting' | 'room-block';
export type AdminCommand =
  | { kind: 'property-update'; targetId: string; tag: string; body: PropertyUpdateRequest }
  | { kind: 'room-type-create'; body: RoomTypeCreateRequest }
  | { kind: 'connecting-update'; targetId: string; tag: string; body: ConnectingRoomRequest }
  | { kind: 'room-block-create'; body: RoomBlockCreateRequest }
  | { kind: 'room-block-delete'; targetId: string; reason: string };
export interface AdminIntent {
  ownerId: string;
  key: string;
  createdAt: number;
  command: AdminCommand;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || !field) throw Error('Invalid command field');
  return field;
}
export function parseCommand(value: unknown, scope: AdminScope): AdminCommand {
  if (!record(value)) throw Error('Invalid command');
  if (scope === 'room-block') return parseBlock(value);
  if (scope === 'property' && value.kind === 'property-update') {
    const tag = text(value, 'tag');
    if (!/^"\d+"$/.test(tag)) throw Error('Invalid version');
    return {
      kind: 'property-update',
      targetId: propertySummarySchema.shape.id.parse(value.targetId),
      tag,
      body: propertyUpdateRequestSchema.parse(value.body),
    };
  }
  if (scope === 'room-type' && value.kind === 'room-type-create')
    return { kind: 'room-type-create', body: roomTypeCreateRequestSchema.parse(value.body) };
  if (scope === 'connecting' && value.kind === 'connecting-update') return parseConnecting(value);
  throw Error('Wrong command scope');
}
function parseConnecting(
  value: Record<string, unknown>,
): Extract<AdminCommand, { kind: 'connecting-update' }> {
  const tag = text(value, 'tag');
  if (!/^"\d+"$/.test(tag) || BigInt(tag.slice(1, -1)) > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error('Invalid room version');
  return {
    kind: 'connecting-update',
    targetId: roomSummarySchema.shape.id.parse(value.targetId),
    tag,
    body: connectingRoomRequestSchema.parse(value.body),
  };
}
export function intentStorageKey(ownerId: string, scope: AdminScope): string {
  return 'pinehill-admin:' + scope + ':' + encodeURIComponent(ownerId);
}
export function readAdminIntent(raw: string, ownerId: string, scope: AdminScope): AdminIntent {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.ownerId !== ownerId) throw Error('Wrong intent owner');
  const key = text(value, 'key');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key))
    throw Error('Invalid intent key');
  const createdAt = value.createdAt;
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0)
    throw Error('Invalid intent clock');
  return { ownerId, key, createdAt, command: parseCommand(value.command, scope) };
}
export function replayBeforeExpiry(intent: AdminIntent, now: number): boolean {
  return now >= intent.createdAt && now - intent.createdAt < 86400000;
}

function parseBlock(value: Record<string, unknown>): AdminCommand {
  if (value.kind === 'room-block-create')
    return { kind: 'room-block-create', body: roomBlockCreateRequestSchema.parse(value.body) };
  if (value.kind === 'room-block-delete')
    return {
      kind: 'room-block-delete',
      targetId: roomBlockSchema.shape.id.parse(value.targetId),
      reason: roomBlockCreateRequestSchema.shape.note.unwrap().trim().parse(value.reason),
    };
  throw Error('Wrong block command');
}
