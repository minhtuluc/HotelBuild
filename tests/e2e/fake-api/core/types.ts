import type { BookingSummary, UserSummary, ChannelCode } from '../../../../packages/contracts/src/index.js';
export interface FakeActor {
  key: string;
  guest: boolean;
  role: UserSummary['role'];
  propertyIds: string[];
}
export interface FakeBooking {
  channelCode: ChannelCode;
  value: BookingSummary;
  owner: string;
}
export interface FakeRequest {
  method: string;
  url: URL;
  body: unknown;
  authorization: string | undefined;
  idempotencyKey?: string;
}
export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
export type FakeHandler = (
  request: FakeRequest,
) => FakeResponse | undefined | Promise<FakeResponse | undefined>;

export interface FakeApiContext {
  authenticateGuest?: (authorization: string | undefined) => string | undefined;
  authenticateActor?: (authorization: string | undefined) => FakeActor | undefined;
  configureActor?: (key: string, role: FakeActor['role'], propertyIds: string[]) => void;
  getGuestId?: (owner: string) => string;
  listBookings?: () => FakeBooking[];
  getBooking?: (id: string) => FakeBooking | undefined;
  deleteBooking?: (id: string) => void;
}
