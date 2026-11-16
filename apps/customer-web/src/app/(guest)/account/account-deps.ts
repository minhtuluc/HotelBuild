'use client';

/** Cổng thật của các luồng SCR-08: mọi lệnh qua BFF phiên `@pinehill/web-session` (HB-324, TD-41). */
import { guestSession } from '../../../session/guest-session';
import {
  confirmPasswordReset,
  registerGuest,
  requestPasswordReset,
} from '@pinehill/web-session/client';
import type { FlowDeps } from './account-flows';

export const browserDeps: FlowDeps = {
  register: (body) => registerGuest(body),
  login: (phone, password) => guestSession().login({ phone, password }),
  requestReset: (phone) => requestPasswordReset(phone),
  confirmReset: (token, newPassword) => confirmPasswordReset(token, newPassword),
};
