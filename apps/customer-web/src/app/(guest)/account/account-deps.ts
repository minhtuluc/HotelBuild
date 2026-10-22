'use client';

/** Cổng thật của các luồng SCR-08: BFF cùng origin cho lệnh công khai, proxy phiên cho đăng nhập. */
import { guestSession } from '../../../session/guest-session';
import { confirmPasswordReset, registerGuest, requestPasswordReset } from './account-api';
import type { FlowDeps } from './account-flows';

export const browserDeps: FlowDeps = {
  register: (body) => registerGuest(body),
  login: (phone, password) => guestSession().login({ phone, password }),
  requestReset: (phone) => requestPasswordReset(phone),
  confirmReset: (token, newPassword) => confirmPasswordReset(token, newPassword),
};
