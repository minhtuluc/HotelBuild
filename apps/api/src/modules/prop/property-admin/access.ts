import { Inject, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import type { IdempotencyAccess } from '../../../common/idempotency/decorators.js';
import type { AuthorizedActor } from '../../../common/actor/authorized-actor.js';
import { requireProperty } from '../../../common/rbac/scope.js';
import { actor, expected, missing, uuid, invalid, forbidden } from './support.js';
import {
  propertyInput,
  typeCreate,
  typeUpdate,
  roomCreate,
  roomUpdate,
  linkInput,
} from './validation.js';
import type { Kind } from './validation.js';
import { permission } from './mutation.js';
function kind(request: FastifyRequest): Kind {
  const path = request.url.split('?')[0]!;
  if (path.includes('/properties')) return 'property';
  if (path.includes('/room-types')) return 'type';
  return path.endsWith('/connecting-room') ? 'link' : 'room';
}
@Injectable()
export class PropertyAccess implements IdempotencyAccess {
  constructor(@Inject(PRISMA) readonly db: PrismaClient) {}
  async authorize(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>(),
      current = actor(request),
      resource = kind(request);
    if (!current.hasPermission(permission(resource))) throw forbidden();
    if (request.method === 'POST') await this.create(current, resource, request.body);
    else {
      expected(request.headers['if-match']);
      await this.existing(current, resource, request);
    }
    return { type: 'USER' as const, id: current.id };
  }
  private async create(current: AuthorizedActor, resource: Kind, body: unknown) {
    const input = resource === 'type' ? typeCreate(body) : roomCreate(body);
    requireProperty(current, input.propertyId);
    if (!(await this.db.properties.findUnique({ where: { id: input.propertyId } })))
      throw missing();
    if (resource === 'type') return;
    const room = roomCreate(body),
      target = await this.db.room_types.findUnique({ where: { id: room.roomTypeId } });
    if (!target) throw missing();
    requireProperty(current, target.property_id);
    if (target.property_id !== room.propertyId) throw invalid();
  }
  private async existing(current: AuthorizedActor, resource: Kind, request: FastifyRequest) {
    const params = z.record(z.string(), z.unknown()).safeParse(request.params);
    if (!params.success) throw invalid();
    const field =
        resource === 'property' ? 'propertyId' : resource === 'type' ? 'roomTypeId' : 'roomId',
      id = uuid(params.data[field]);
    if (resource === 'property') {
      propertyInput(request.body);
      if (!(await this.db.properties.findUnique({ where: { id } }))) throw missing();
      requireProperty(current, id);
      return;
    }
    if (resource === 'type') {
      typeUpdate(request.body);
      const target = await this.db.room_types.findUnique({ where: { id } });
      if (!target) throw missing();
      requireProperty(current, target.property_id);
      return;
    }
    await this.room(current, resource, id, request.body);
  }
  private async room(current: AuthorizedActor, resource: Kind, id: string, body: unknown) {
    const target = await this.db.rooms.findUnique({ where: { id } });
    if (!target) throw missing();
    requireProperty(current, target.property_id);
    if (resource !== 'link') {
      roomUpdate(body);
      return;
    }
    const input = linkInput(body);
    if (input.connectingRoomId === null) return;
    const other = await this.db.rooms.findUnique({ where: { id: input.connectingRoomId } });
    if (!other) throw missing();
    requireProperty(current, other.property_id);
  }
}
