import type { KeyValueStorage } from '../storage';

export interface OfflineContext {
  readonly userId: string;
  readonly role: string;
  readonly propertyId: string;
  readonly propertyScope: readonly string[];
}
export type OfflineAction =
  | {
      readonly kind: 'HOUSEKEEPING_STATUS';
      readonly taskId: string;
      readonly roomId: string;
      readonly businessDate: string;
      readonly version: number;
      readonly status: 'IN_PROGRESS' | 'DONE';
    }
  | { readonly kind: 'NOTE_DRAFT'; readonly text: string }
  | { readonly kind: 'SEARCH_DRAFT'; readonly query: string };
export type QueuePhase = 'DRAFT' | 'QUEUED' | 'SENDING' | 'CONFIRMED' | 'NEEDS_REVIEW';
export type ReviewReason =
  'UNKNOWN_RESULT' | 'CONFLICT' | 'AUTHORIZATION' | 'LOOKUP_REQUIRED' | 'UNSUPPORTED' | 'REJECTED';
export interface QueueEntry {
  readonly key: string;
  readonly context: OfflineContext;
  readonly action: OfflineAction;
  readonly createdAt: number;
  readonly phase: QueuePhase;
  readonly attempted: boolean;
  readonly lastAttemptAt: number | null;
  readonly reason: ReviewReason | null;
}
export interface QueueReceipt {
  readonly key: string;
  readonly context: OfflineContext;
  readonly action: OfflineAction;
  readonly status: 'CONFIRMED';
}
export interface QueueDeps {
  readonly context: OfflineContext;
  readonly storage: KeyValueStorage;
  watch?(listener: () => void): () => void;
  createId(): string;
  now(): number;
  online(): Promise<boolean>;
  supports(action: OfflineAction): boolean;
  authorize(signal: AbortSignal): Promise<OfflineContext>;
  send(entry: QueueEntry, signal: AbortSignal): Promise<unknown>;
  /** A durable command receipt, never equality with a current resource projection. */
  lookup?(entry: QueueEntry, signal: AbortSignal): Promise<unknown>;
}
export class QueueFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'QueueFailure';
  }
}
