import { Controller, Get, Inject } from '@nestjs/common';
import { HealthCheckService } from './health-check.service.js';

@Controller('system/health')
export class SystemHealthController {
  constructor(@Inject(HealthCheckService) private readonly service: HealthCheckService) {}

  @Get()
  status(): Promise<{ status: 'ok' }> {
    return this.service.status();
  }
}
