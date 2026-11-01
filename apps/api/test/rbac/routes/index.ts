import type { Oracle } from './types.js';
import { f1Auth } from './f1-auth.js';
import { f2Property } from './f2-property.js';
import { f3Rate } from './f3-rate.js';
import { f4Booking } from './f4-booking.js';
import { f5Pay } from './f5-pay.js';
import { f7FrontOffice } from './f7-front-office.js';
import { f8Report } from './f8-report.js';

export type { Expected } from './types.js';

/**
 * Oracle RBAC độc lập, ghép theo module. Giữ nguyên toàn bộ kỳ vọng của tệp gốc;
 * F6 thêm `f6-over.ts` khi hợp đồng HB-120 phát hành thay vì nới trần `max-lines`.
 */
export function independentOracle(): Oracle {
  const oracle: Oracle = {};
  f1Auth(oracle);
  f2Property(oracle);
  f3Rate(oracle);
  f4Booking(oracle);
  f5Pay(oracle);
  f7FrontOffice(oracle);
  f8Report(oracle);
  return oracle;
}
