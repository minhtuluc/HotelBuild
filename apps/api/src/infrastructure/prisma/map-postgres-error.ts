import { AppError } from '../../common/app-error.js';

const exclusions = new Set([
  'excl_room_assignments_no_double_booking',
  'excl_booking_room_one_assignment',
]);

export function mapPostgresError(error: unknown): unknown {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23P01' &&
    'constraint' in error &&
    typeof error.constraint === 'string' &&
    exclusions.has(error.constraint)
  )
    return new AppError(409, 'E_INV_ROOM_TAKEN', 'Room or bed is already assigned for these dates');
  return error;
}
