import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { HEALTH_PROBES } from '../../infrastructure/health/health-probe.js';
import type { HealthProbe } from '../../infrastructure/health/health-probe.js';

@Injectable()
export class HealthCheckService {
  constructor(@Inject(HEALTH_PROBES) private readonly probes: readonly HealthProbe[]) {}

  async status(): Promise<{ status: 'ok' }> {
    const results = await Promise.all(this.probes.map((probe) => probe.check()));
    if (!results.every(Boolean)) {
      throw new AppError(503, 'E_GEN_SERVICE_UNAVAILABLE', 'Hệ thống tạm thời không sẵn sàng.');
    }
    return { status: 'ok' };
  }
}
