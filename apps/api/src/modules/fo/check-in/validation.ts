/**
 * Cú pháp lệnh và mốc giờ nghiệp vụ của `POST /front-office/check-in` (HB-144).
 *
 * Mốc giờ đi qua cổng `CLOCK` như mọi harness F1/F7: ADR-014 đòi giờ CSDL cho **thời điểm quyết định
 * sau khoá**, còn ngày VN/23:59 là *luật nghiệp vụ* (BR-FO-02, BR-FO-04) nên phải đọc được bằng đồng
 * hồ tiêm (test khoá HB-143 điều khiển mốc bằng `clock.value`). Một lần đọc `clock_timestamp()` sau
 * khoá vẫn được dùng cho `booking_status_history.at` + `checkedInAt` của phản hồi.
 */
import { z } from 'zod';
import { checkInRequestSchema } from '@pinehill/contracts';
import type { CheckInInput } from '@pinehill/domain/front-office';
import { invalid } from './errors.js';

/** Ngày VN + số mili-giây kể từ nửa đêm — đúng hình dạng engine HB-141 nhận. */
const TIME_ZONE = 'Asia/Ho_Chi_Minh' as const;

const commandSchema = checkInRequestSchema.extend({
  bookingId: z.uuid(),
  actualRoomIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'actualRoomIds must be unique'),
});

export type Command = z.infer<typeof commandSchema>;

export function command(value: unknown): Command {
  const result = commandSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

const parts = (at: Date, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour12: false, ...options })
    .formatToParts(at)
    .reduce<Record<string, string>>((all, part) => {
      all[part.type] = part.value;
      return all;
    }, {});

/** Ngày dương lịch + mili-giây trong ngày theo giờ VN (không DST). */
export function localNow(at: Date): CheckInInput['localNow'] {
  const fields = parts(at, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  // `hour12: false` của ICU có thể trả "24" cho nửa đêm; chuẩn hoá về 0.
  const hour = Number(fields.hour) % 24;
  return {
    date: `${fields.year}-${fields.month}-${fields.day}`,
    millisecondsSinceMidnight:
      ((hour * 60 + Number(fields.minute)) * 60 + Number(fields.second)) * 1000,
    timeZone: TIME_ZONE,
  };
}
