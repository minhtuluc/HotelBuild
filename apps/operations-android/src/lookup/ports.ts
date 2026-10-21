/** Nối SCR-62 với hai tuyến đọc có sẵn qua `@pinehill/api-client` (không thêm endpoint). */
import { createBookingApi, createGuestApi } from '@pinehill/api-client';
import type { Session } from '../session';
import type { LookupPorts } from './reader';

export function lookupPorts(session: Session): LookupPorts {
  return {
    actor: () => session.profile(),
    guests: async (query) => (await createGuestApi(session.resourceClient()).list(query)).data,
    bookings: async (query) => (await createBookingApi(session.resourceClient()).list(query)).data,
  };
}
