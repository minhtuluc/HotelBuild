import { expect, test } from 'vitest';
import { AppError } from '../../src/common/app-error.js';
import { mapPostgresError } from '../../src/infrastructure/prisma/map-postgres-error.js';

test.each(['excl_room_assignments_no_double_booking', 'excl_booking_room_one_assignment'])(
  'maps only room exclusion %s to a safe HTTP409 conflict',
  (constraint) => {
    const error = {
      code: '23P01',
      constraint,
      message: 'synthetic database detail',
      detail: 'private SQL values',
    };
    const mapped = mapPostgresError(error);
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({ status: 409, code: 'E_INV_ROOM_TAKEN' });
    expect(String(mapped)).not.toContain(error.message);
    expect(String(mapped)).not.toContain(error.detail);
  },
);
test.each([
  null,
  undefined,
  '23P01',
  42,
  true,
  new Error('original'),
  { code: '23505', constraint: 'excl_room_assignments_no_double_booking' },
  { code: '23514', constraint: 'excl_room_assignments_no_double_booking' },
  { code: '40001', constraint: 'excl_booking_room_one_assignment' },
  { code: '23P01', constraint: 'some_other_exclusion' },
  { code: '23P01' },
  { constraint: 'excl_room_assignments_no_double_booking' },
  { code: '23P01', constraint: null },
])('keeps all other errors unchanged by identity %#', (error) => {
  expect(mapPostgresError(error)).toBe(error);
});
