/**
 * HB-244 — ảnh công khai của cơ sở và loại phòng (yêu cầu frontend #5).
 *
 * - Đọc quản trị (`GET …/photos`): danh sách + ETag, theo phạm vi cơ sở.
 * - Thay (`PUT …/photos`): khoá dòng cha `FOR UPDATE`, so ETag hiện tại với `If-Match`, xoá rồi chèn lại
 *   đúng thứ tự trong cùng transaction, ghi AuditLog (trước/sau + lý do đã che PII).
 * - Công khai (`GET /public/room-types/{id}`): chỉ loại phòng ACTIVE của cơ sở ACTIVE.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PhotoList, RoomTypePublic } from '@pinehill/contracts';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import type { AuditWriter } from '../../../infrastructure/audit/audit-writer.js';
import { maskText } from '../../rate/rate-plans/support.js';
import {
  conflict,
  forbidden,
  missing,
  photosEtag,
  photoView,
  type PhotoReplaceInput,
  type PhotoRow,
} from './support.js';

type Tx = Prisma.TransactionClient;
const ordered = { orderBy: { position: 'asc' as const } };

export type PhotoOwner = 'Property' | 'RoomType';

export class PhotosService {
  constructor(
    readonly db: PrismaClient,
    readonly audit: AuditWriter,
  ) {}

  async list(actor: AuthorizedActor, owner: PhotoOwner, id: string): Promise<PhotoList> {
    return this.db.$transaction(
      async (tx) => {
        requireProperty(actor, await this.propertyOf(tx, owner, id));
        const rows = await this.rows(tx, owner, id);
        return { photos: rows.map(photoView), etag: photosEtag(rows) };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async replace(
    tx: Tx,
    actor: AuthorizedActor,
    owner: PhotoOwner,
    id: string,
    ifMatch: string,
    input: PhotoReplaceInput,
  ): Promise<void> {
    if (actor.role !== 'OWNER') throw forbidden();
    await this.lock(tx, owner, id);
    requireProperty(actor, await this.propertyOf(tx, owner, id));
    const before = await this.rows(tx, owner, id);
    if (photosEtag(before) !== ifMatch) throw conflict();
    const data = input.photos.map((photo, position) => ({ ...photoView(photo), position }));
    if (owner === 'Property') {
      await tx.property_photos.deleteMany({ where: { property_id: id } });
      await tx.property_photos.createMany({
        data: data.map((row) => ({ ...row, property_id: id })),
      });
    } else {
      await tx.room_type_photos.deleteMany({ where: { room_type_id: id } });
      await tx.room_type_photos.createMany({
        data: data.map((row) => ({ ...row, room_type_id: id })),
      });
    }
    await this.audit.record(tx, {
      actor,
      action: owner === 'Property' ? 'PROPERTY_PHOTOS_REPLACED' : 'ROOM_TYPE_PHOTOS_REPLACED',
      entityType: owner,
      entityId: id,
      beforeJson: { photos: before.map(photoView) },
      afterJson: { photos: data.map(photoView) },
      reason: maskText(input.reason),
    });
  }

  async publicRoomType(id: string): Promise<RoomTypePublic> {
    const row = await this.db.room_types.findFirst({
      where: { id, status: 'ACTIVE', properties: { status: 'ACTIVE' } },
      include: { room_type_photos: ordered },
    });
    if (row === null) throw missing();
    return {
      id: row.id,
      propertyId: row.property_id,
      code: row.code,
      name: row.name,
      capacityAdults: row.capacity_adults,
      capacityChildren: row.capacity_children,
      photos: row.room_type_photos.map(photoView),
    };
  }

  private async propertyOf(tx: Tx, owner: PhotoOwner, id: string): Promise<string> {
    if (owner === 'Property') {
      const property = await tx.properties.findUnique({ where: { id }, select: { id: true } });
      if (property === null) throw missing();
      return property.id;
    }
    const type = await tx.room_types.findUnique({ where: { id }, select: { property_id: true } });
    if (type === null) throw missing();
    return type.property_id;
  }

  /** Khoá dòng cha để hai lệnh thay cùng lúc nối tiếp nhau (lệnh sau thấy ETag mới ⇒ 412). */
  private async lock(tx: Tx, owner: PhotoOwner, id: string): Promise<void> {
    const locked =
      owner === 'Property'
        ? await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM properties WHERE id=${id}::uuid FOR UPDATE`
        : await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM room_types WHERE id=${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw missing();
  }

  private rows(tx: Tx, owner: PhotoOwner, id: string): Promise<PhotoRow[]> {
    return owner === 'Property'
      ? tx.property_photos.findMany({ where: { property_id: id }, ...ordered })
      : tx.room_type_photos.findMany({ where: { room_type_id: id }, ...ordered });
  }
}
