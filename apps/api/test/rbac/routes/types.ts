import { RequestMethod } from '@nestjs/common';

export interface Expected {
  roles: readonly string[];
  status: number;
  method: RequestMethod;
}

export type Oracle = Record<string, Expected>;

/** `GET` trên id oracle không tồn tại ⇒ 404 trước khi chạm dữ liệu. */
export const readMissing = (roles: readonly string[]): Expected => ({
  roles,
  status: 404,
  method: RequestMethod.GET,
});

export const GUEST_STAFF = ['FRONT_DESK', 'RESERVATION_AGENT', 'MANAGER', 'OWNER'] as const;
