import type {
  PropertySummary,
  RoomTypeSummary,
  RoomSummary,
  RoomBlock,
  UserMe,
} from '@pinehill/contracts';
import type { AdminCommand, AdminScope } from './intent';
export interface AdminData {
  properties: readonly PropertySummary[];
  roomTypes: readonly RoomTypeSummary[];
  rooms?: readonly RoomSummary[];
  blocks?: readonly RoomBlock[];
}
export type AdminReceipt =
  | { kind: 'property-update'; data: PropertySummary }
  | { kind: 'room-type-create'; data: RoomTypeSummary }
  | { kind: 'connecting-update'; data: RoomSummary }
  | { kind: 'room-block-create'; data: RoomBlock }
  | { kind: 'room-block-delete'; id: string };
export interface AdminPorts {
  actor(
    signal: AbortSignal,
  ): Promise<Pick<UserMe, 'userId' | 'role'> & { propertyScope?: readonly string[] }>;
  read(signal: AbortSignal): Promise<AdminData>;
  write(command: AdminCommand, id: string, signal: AbortSignal): Promise<AdminReceipt>;
}
export interface Options {
  ports: AdminPorts;
  scope: AdminScope;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  createId: () => string;
  now: () => number;
}
export interface AdminState {
  phase:
    'loading' | 'ready' | 'error' | 'validation' | 'conflict' | 'unknown' | 'forbidden' | 'expired';
  data: AdminData | null;
  canWrite: boolean;
  canRemove: boolean;
  actorVerified: boolean;
  actorRevision: number;
  busy: boolean;
  error: unknown;
  receipt: AdminReceipt | null;
  referenceId: string | null;
  canCompare: boolean;
  issues: readonly { field: string; issue: string }[];
}
