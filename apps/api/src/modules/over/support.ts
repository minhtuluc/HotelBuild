/**
 * Tiện ích dùng chung module OVER (HB-125): lỗi hợp đồng, If-Match, phạm vi cơ sở, khoá phòng,
 * ngày/tiền và các hàm đọc nhanh trạng thái `writeIntent`.
 *
 * Không chứa luật nghiệp vụ: planner/merge/walkout do `@pinehill/domain` quyết; tệp này chỉ giữ
 * những phép đổi kiểu và tiền kiểm lặp lại ở nhiều use case.
 */
import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AuthorizedActor } from '../../common/actor/authorized-actor.js';
import { isAuthorizedActor } from '../../common/actor/authorized-actor.js';
import { AppError } from '../../common/app-error.js';
import type { ErrorCode } from '@pinehill/contracts';

export type Tx = Prisma.TransactionClient;

/** Phiên phải đã qua `RbacGuard`; route OVER không có tuyến công khai. */
export function actorOf(request: FastifyRequest): AuthorizedActor {
  if (!isAuthorizedActor(request.actor))
    throw new AppError(401, 'E_AUTH_INVALID_CREDENTIALS', 'Chưa xác thực.');
  return request.actor;
}

export const notFound = (message = 'Không tìm thấy dữ liệu điều chuyển.') =>
  new AppError(404, 'E_GEN_NOT_FOUND', message);

/** `:id` của route hiện tại, đã kiểm kiểu (không tin shape của `request.params`). */
export function pathId(request: FastifyRequest): string {
  const params: unknown = request.params;
  if (
    typeof params !== 'object' ||
    params === null ||
    !('id' in params) ||
    typeof params.id !== 'string' ||
    params.id.length === 0
  )
    throw notFound();
  return params.id;
}

export const invalid = (message = 'Dữ liệu không hợp lệ.') =>
  new AppError(400, 'E_GEN_VALIDATION_FAILED', message);

export const outOfScope = () =>
  new AppError(403, 'E_AUTH_OUT_OF_SCOPE', 'Bạn không được truy cập dữ liệu của cơ sở này.');

export const businessConflict = (code: ErrorCode, message: string) =>
  new AppError(409, code, message);

export const preconditionRequired = () =>
  new AppError(428, 'E_GEN_PRECONDITION_REQUIRED', 'Cần If-Match (ETag) cho thao tác này.');

export const versionConflict = () =>
  new AppError(412, 'E_GEN_VERSION_CONFLICT', 'Dữ liệu đã thay đổi; hãy tải lại.');

/** `If-Match` bắt buộc cho lệnh ghi có phiên bản; thiếu ⇒ 428, lệch ⇒ 412. */
export function requireIfMatch(value: unknown, expected: string): void {
  if (value === undefined) throw preconditionRequired();
  if (typeof value !== 'string' || value !== expected) throw versionConflict();
}

/** ETag của move gộp phiên bản move + booking liên quan (đổi booking cũng làm tem cũ). */
export function moveETag(moveVersion: bigint | number, bookingVersion: bigint | number): string {
  return `"${moveVersion}-${bookingVersion}"`;
}

export function mergeETag(version: bigint | number): string {
  return `"${version}"`;
}

export function bookingETag(version: bigint | number): string {
  return `"${version}"`;
}

/** Mọi cơ sở liên quan (nguồn/đích) đều phải nằm trong phạm vi của phiên. */
export function requireProperties(
  actor: AuthorizedActor,
  properties: readonly (string | null | undefined)[],
): void {
  for (const propertyId of new Set(properties.filter((id): id is string => Boolean(id)))) {
    if (!actor.canActOn(propertyId)) throw outOfScope();
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

export function money(value: bigint | number): number {
  const asNumber = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(asNumber) || asNumber < 0) throw invalid('Số tiền vượt giới hạn.');
  return asNumber;
}

export function toBigInt(value: bigint | number | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/** `@db.Date` trả `Date` UTC nửa đêm ⇒ `YYYY-MM-DD`; chuỗi đã đúng dạng thì giữ nguyên. */
export function businessDate(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

const DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.max(1, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / DAY));
}

/** Mốc nhận phòng 14:00 giờ VN (UTC+7, không có DST) của một ngày nghiệp vụ. */
export function arrivalMs(date: string): number {
  return Date.parse(`${date}T14:00:00+07:00`);
}

/** Hạn xử lý ca = T−24h (BR-OVER-16). */
export function resolveDeadline(date: string): Date {
  return new Date(arrivalMs(date) - DAY);
}

/** Khoá phòng đích trong thứ tự ổn định trước khi kiểm tồn/ghi assignment. */
export async function lockRoom(tx: Tx, roomId: string): Promise<void> {
  const found = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM rooms WHERE id=${roomId}::uuid FOR UPDATE`;
  if (found.length !== 1) throw notFound('Không tìm thấy phòng đích.');
}

export interface ActiveAssignmentRow {
  id: string;
  booking_room_id: string;
  room_id: string;
  bed_no: number;
  start_date: Date;
  end_date: Date;
}

export async function lockAssignment(
  tx: Tx,
  bookingRoomId: string,
): Promise<ActiveAssignmentRow[]> {
  return tx.$queryRaw<ActiveAssignmentRow[]>`
    SELECT id, booking_room_id, room_id, bed_no, start_date, end_date
      FROM room_assignments
     WHERE booking_room_id=${bookingRoomId}::uuid AND released_at IS NULL
     ORDER BY id FOR UPDATE`;
}

/** Có assignment đang giữ phòng trong khoảng lưu trú hay không (kiểm tồn mọi đêm). */
export async function roomTaken(
  tx: Tx,
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeBookingRoomId?: string,
): Promise<boolean> {
  const rows =
    excludeBookingRoomId === undefined
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM room_assignments
           WHERE room_id=${roomId}::uuid AND released_at IS NULL
             AND valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
           LIMIT 1`
      : await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM room_assignments
           WHERE room_id=${roomId}::uuid AND released_at IS NULL
             AND booking_room_id <> ${excludeBookingRoomId}::uuid
             AND valid_range && daterange(${checkIn}::date, ${checkOut}::date, '[)')
           LIMIT 1`;
  return rows.length > 0;
}

/** Đọc `writeIntent` theo `Idempotency-Key` để client tra lại sau timeout (HB-120 AC12). */
export async function writeIntentOf(
  tx: Tx | Prisma.TransactionClient,
  actor: AuthorizedActor,
  key: string | undefined,
  resourceType: 'ROOM_MOVE' | 'ROOM_MERGE' | 'RELOCATION_PLAN',
  resourceId: string | null,
  operationId: string | null,
) {
  if (key === undefined) return null;
  const rows = await tx.$queryRaw<
    { status: string; created_at: Date; response_status: number | null }[]
  >`SELECT status, created_at, response_status FROM idempotency_keys
     WHERE key=${key} AND principal_type='USER' AND principal_id=${actor.id}::uuid
     ORDER BY created_at DESC LIMIT 1`;
  const row = rows[0];
  if (row === undefined)
    return {
      idempotencyKey: key,
      state: 'NOT_FOUND' as const,
      resourceType,
      resourceId: null,
      operationId: null,
      recordedAt: null,
    };
  const state =
    row.status === 'COMPLETED'
      ? ('SUCCEEDED' as const)
      : row.status === 'IN_PROGRESS'
        ? ('IN_PROGRESS' as const)
        : ('FAILED' as const);
  return {
    idempotencyKey: key,
    state,
    resourceType,
    resourceId,
    operationId,
    recordedAt: row.created_at.toISOString(),
  };
}

/** Mã lỗi Prisma của ràng buộc loại trừ/trigger, dùng để đổi sang 409 hợp đồng. */
export function prismaSqlState(error: unknown): string | null {
  if (!(error instanceof PrismaNamespace.PrismaClientKnownRequestError)) return null;
  const meta: unknown = error.meta;
  if (typeof meta !== 'object' || meta === null || !('code' in meta)) return null;
  return typeof meta.code === 'string' ? meta.code : null;
}
