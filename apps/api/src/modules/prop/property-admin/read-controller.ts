import { Controller, Get, Inject, Query, Req, Header } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Permission } from '../../../common/rbac/permissions.js';
import { Public } from '../../../common/guards/decorators.js';
import { PropertyReads } from './reads.js';
import { parsed, propertyQuery, typeQuery, roomQuery } from './queries.js';
import { actor } from './support.js';
@Controller()
export class PropertyReadController {
  constructor(@Inject(PropertyReads) readonly service: PropertyReads) {}
  @Permission('propertyAdmin.read')
  @Get('properties')
  @Header('Cache-Control', 'no-store')
  properties(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.properties(actor(request), parsed(propertyQuery, query));
  }
  @Public()
  @Get('public/properties')
  @Header('Cache-Control', 'no-store')
  publicProperties(@Query() query: unknown) {
    return this.service.properties(undefined, parsed(propertyQuery, query));
  }
  @Permission('propertyAdmin.read')
  @Get('room-types')
  @Header('Cache-Control', 'no-store')
  types(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.types(actor(request), parsed(typeQuery, query));
  }
  @Permission('propertyAdmin.read')
  @Get('rooms')
  @Header('Cache-Control', 'no-store')
  rooms(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.service.rooms(actor(request), parsed(roomQuery, query));
  }
}
