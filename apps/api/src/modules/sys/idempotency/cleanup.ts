import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { IdempotencyStore } from '../../../common/idempotency/store.js';

@Injectable()
export class IdempotencyCleanup implements OnModuleInit, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private flight: Promise<void> | undefined;
  constructor(
    @Inject(IdempotencyStore) private readonly store: IdempotencyStore,
    @InjectPinoLogger(IdempotencyCleanup.name) private readonly logger: PinoLogger,
  ) {}
  onModuleInit(): void {
    this.timer = setInterval(
      () => {
        void this.sweep();
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }
  sweep(): Promise<void> {
    this.flight ??= this.batches()
      .catch(() => {
        this.logger.warn(
          { event: 'idempotency_cleanup_failed' },
          'Dọn khoá thất bại; thử lại ở kỳ tiếp theo.',
        );
      })
      .finally(() => {
        this.flight = undefined;
      });
    return this.flight;
  }
  private async batches(): Promise<void> {
    for (let batch = 0; batch < 20; batch++) {
      if ((await this.store.purgeExpired()) < 500) return;
    }
  }
  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.flight;
  }
}
