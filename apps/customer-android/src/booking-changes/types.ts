import type {
  BookingSummary,
  CancelPreview,
  CancelRequest,
  CancelResponse,
  Quote,
  RescheduleRequest,
} from '@pinehill/contracts';
import type { NetInfoSource } from '../netinfo';

export type ChangeKind = 'cancel' | 'reschedule';
export interface ChangeDraft {
  reason: 'GUEST_REQUEST' | 'FORCE_MAJEURE';
  note: string;
  evidenceRefs: string[];
  checkIn: string;
  checkOut: string;
}
export type ChangePreview =
  { kind: 'cancel'; data: CancelPreview } | { kind: 'reschedule'; data: Quote };
export type ChangeResult =
  { kind: 'cancel'; data: CancelResponse } | { kind: 'reschedule'; data: BookingSummary };
export interface ChangeIntent {
  kind: ChangeKind;
  bookingId: string;
  etag: string;
  key: string;
  createdAt: number;
  body: CancelRequest | RescheduleRequest;
}
export interface ChangeApi {
  preview(draft: ChangeDraft): Promise<ChangePreview>;
  commit(intent: ChangeIntent): Promise<ChangeResult>;
}
export interface ChangeDeps {
  kind: ChangeKind;
  bookingId: string;
  etag: string;
  api: ChangeApi;
  net: NetInfoSource;
  now(): number;
  createId(): string;
  store?: IntentStore;
}
export interface IntentStore {
  load(): Promise<ChangeIntent | null>;
  save(intent: ChangeIntent): Promise<void>;
  clear(): Promise<void>;
}
export interface ChangeState {
  phase:
    | 'editing'
    | 'previewing'
    | 'previewed'
    | 'submitting'
    | 'unknown'
    | 'done'
    | 'denied'
    | 'conflict';
  preview: ChangePreview | null;
  result: ChangeResult | null;
  notice: string | null;
}
