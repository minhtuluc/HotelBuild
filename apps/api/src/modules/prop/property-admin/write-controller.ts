import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  HttpCode,
  UseInterceptors,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { PropertyAccess } from './access.js';
import { PropertyETag } from './etag.js';
import { ConfigurationCommands } from './configuration.js';
import { RoomCommands } from './rooms.js';
import { ConnectingCommands } from './connecting.js';
import { actor, expected, uuid } from './support.js';
@Controller()
@UseInterceptors(PropertyETag)
export class PropertyWriteController {
  constructor(
    @Inject(ConfigurationCommands) readonly config: ConfigurationCommands,
    @Inject(RoomCommands) readonly rooms: RoomCommands,
    @Inject(ConnectingCommands) readonly links: ConnectingCommands,
    @Inject(IdempotencyContext) readonly context: IdempotencyContext,
  ) {}
  @Permission('propertyAdmin.configure')
  @Idempotent(PropertyAccess)
  @Patch('properties/:propertyId')
  property(@Param('propertyId') id: string, @Body() body: unknown, @Req() r: FastifyRequest) {
    return this.config.property(
      this.context.transaction(),
      actor(r),
      uuid(id),
      expected(r.headers['if-match']),
      body,
    );
  }
  @Permission('propertyAdmin.configure')
  @Idempotent(PropertyAccess)
  @Post('room-types')
  @HttpCode(201)
  createType(@Body() body: unknown, @Req() r: FastifyRequest) {
    return this.config.createType(this.context.transaction(), actor(r), body);
  }
  @Permission('propertyAdmin.configure')
  @Idempotent(PropertyAccess)
  @Patch('room-types/:roomTypeId')
  updateType(@Param('roomTypeId') id: string, @Body() body: unknown, @Req() r: FastifyRequest) {
    return this.config.updateType(
      this.context.transaction(),
      actor(r),
      uuid(id),
      expected(r.headers['if-match']),
      body,
    );
  }
  @Permission('propertyAdmin.rooms')
  @Idempotent(PropertyAccess)
  @Post('rooms')
  @HttpCode(201)
  createRoom(@Body() body: unknown, @Req() r: FastifyRequest) {
    return this.rooms.create(this.context.transaction(), actor(r), body);
  }
  @Permission('propertyAdmin.rooms')
  @Idempotent(PropertyAccess)
  @Patch('rooms/:roomId')
  updateRoom(@Param('roomId') id: string, @Body() body: unknown, @Req() r: FastifyRequest) {
    return this.rooms.update(
      this.context.transaction(),
      actor(r),
      uuid(id),
      expected(r.headers['if-match']),
      body,
    );
  }
  @Permission('propertyAdmin.rooms')
  @Idempotent(PropertyAccess)
  @Put('rooms/:roomId/connecting-room')
  connect(@Param('roomId') id: string, @Body() body: unknown, @Req() r: FastifyRequest) {
    return this.links.update(
      this.context.transaction(),
      actor(r),
      uuid(id),
      expected(r.headers['if-match']),
      body,
    );
  }
}
