import { Body, Controller, Get, Header, HttpCode, Inject, Param, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Public } from '../../../common/guards/decorators.js';
import { Idempotent } from '../../../common/idempotency/decorators.js';
import { IdempotencyContext } from '../../../common/idempotency/context.js';
import { requestActor } from '../../rate/calendar/support.js';
import { PhotoReplaceAccess } from './access.js';
import { PhotosService, type PhotoOwner } from './service.js';
import { expectedEtag, replaceInput, uuid } from './support.js';

/** HB-244 — ảnh công khai: đọc/thay theo cơ sở và loại phòng, cộng tuyến công khai của loại phòng. */
@Controller()
export class PhotosController {
  constructor(
    @Inject(PhotosService) private readonly service: PhotosService,
    @Inject(IdempotencyContext) private readonly context: IdempotencyContext,
  ) {}

  @Get('properties/:propertyId/photos')
  @Header('Cache-Control', 'no-store')
  @Permission('photos.read')
  propertyPhotos(@Param('propertyId') id: string, @Req() request: FastifyRequest) {
    return this.service.list(requestActor(request), 'Property', uuid(id));
  }

  @Put('properties/:propertyId/photos')
  @HttpCode(204)
  @Permission('photos.replace')
  @Idempotent(PhotoReplaceAccess)
  async replacePropertyPhotos(
    @Param('propertyId') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.replace('Property', id, body, request);
  }

  @Get('room-types/:roomTypeId/photos')
  @Header('Cache-Control', 'no-store')
  @Permission('photos.read')
  roomTypePhotos(@Param('roomTypeId') id: string, @Req() request: FastifyRequest) {
    return this.service.list(requestActor(request), 'RoomType', uuid(id));
  }

  @Put('room-types/:roomTypeId/photos')
  @HttpCode(204)
  @Permission('photos.replace')
  @Idempotent(PhotoReplaceAccess)
  async replaceRoomTypePhotos(
    @Param('roomTypeId') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.replace('RoomType', id, body, request);
  }

  @Public()
  @Get('public/room-types/:roomTypeId')
  @Header('Cache-Control', 'no-store')
  publicRoomType(@Param('roomTypeId') id: string) {
    return this.service.publicRoomType(uuid(id));
  }

  private async replace(owner: PhotoOwner, id: string, body: unknown, request: FastifyRequest) {
    await this.service.replace(
      this.context.transaction(),
      requestActor(request),
      owner,
      uuid(id),
      expectedEtag(request.headers['if-match']),
      replaceInput(body),
    );
  }
}
