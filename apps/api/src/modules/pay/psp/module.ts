/**
 * Module cổng thanh toán (HB-094). Xuất **duy nhất** `PAYMENT_GATEWAYS` để module khác (HB-094 online,
 * HB-095 webhook) dùng lại cùng adapter và cùng cấu hình — không nơi nào tự dựng lại adapter.
 */
import { Module } from '@nestjs/common';
import { CONFIG } from '../../../config/env.js';
import type { ApiConfig } from '../../../config/env.js';
import { PAYMENT_GATEWAYS, PaymentGateways } from './gateways.js';
import { pspSettings } from './settings.js';

@Module({
  providers: [
    {
      provide: PAYMENT_GATEWAYS,
      inject: [CONFIG],
      useFactory: (config: ApiConfig) => new PaymentGateways(pspSettings(config)),
    },
  ],
  exports: [PAYMENT_GATEWAYS],
})
export class PspModule {}
