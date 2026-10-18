/**
 * Module hộp thư vào (HB-095; HB-128 sẽ nhập cùng module). Xuất **duy nhất** `WEBHOOK_INBOX` để mọi
 * người nhận webhook dùng chung một cài đặt ghi bền — không module nào tự mở transaction inbox riêng.
 */
import { Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { IdGenerator } from '@pinehill/domain';
import { PRISMA } from '../../../infrastructure/prisma/prisma.module.js';
import { ID_GENERATOR } from '../../../infrastructure/ports.js';
import { WebhookInbox } from './store.js';

export const WEBHOOK_INBOX = Symbol('WEBHOOK_INBOX');

@Module({
  providers: [
    {
      provide: WEBHOOK_INBOX,
      inject: [PRISMA, ID_GENERATOR],
      useFactory: (db: PrismaClient, ids: IdGenerator) => new WebhookInbox(db, ids),
    },
  ],
  exports: [WEBHOOK_INBOX],
})
export class InboxModule {}
