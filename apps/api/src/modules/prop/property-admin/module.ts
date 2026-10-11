import { CLOCK, ID_GENERATOR } from '../../../infrastructure/ports.js';
import type { Clock, IdGenerator } from '@pinehill/domain';
import { PermissionRegistry } from '../../../common/rbac/permission-registry.js';
import { ConfigurationCommands } from './configuration.js';
import { RoomCommands } from './rooms.js';
import { ConnectingCommands } from './connecting.js';
import { PropertyAccess } from './access.js';
import { PropertyETag } from './etag.js';
import { PropertyWriteController } from './write-controller.js';
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { permissionProvider } from '../../../common/rbac/permissions.js';
import { PropertyReadController } from './read-controller.js';
import { PropertyReads } from './reads.js';
@Module({
  controllers: [PropertyReadController, PropertyWriteController],
  providers: [
    permissionProvider('property-admin', {
      'propertyAdmin.read': ['HOUSEKEEPING', 'FRONT_DESK', 'MANAGER', 'OWNER'],
      'propertyAdmin.configure': ['OWNER'],
      'propertyAdmin.rooms': ['MANAGER', 'OWNER'],
    }),
    PropertyAccess,
    PropertyETag,
    {
      provide: ConfigurationCommands,
      inject: [PRISMA, CLOCK, ID_GENERATOR, PermissionRegistry],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator, r: PermissionRegistry) =>
        new ConfigurationCommands(db, clock, ids, r),
    },
    {
      provide: RoomCommands,
      inject: [PRISMA, CLOCK, ID_GENERATOR, PermissionRegistry],
      useFactory: (db: PrismaClient, clock: Clock, ids: IdGenerator, r: PermissionRegistry) =>
        new RoomCommands(db, clock, ids, r),
    },
    {
      provide: ConnectingCommands,
      inject: [PRISMA, CLOCK, PermissionRegistry],
      useFactory: (db: PrismaClient, clock: Clock, r: PermissionRegistry) =>
        new ConnectingCommands(db, clock, r),
    },
    {
      provide: PropertyReads,
      inject: [PRISMA],
      useFactory: (db: PrismaClient) => new PropertyReads(db),
    },
  ],
})
export class PropertyAdminModule {}
