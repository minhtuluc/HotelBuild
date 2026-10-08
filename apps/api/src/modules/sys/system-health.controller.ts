import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../../common/guards/decorators.js';
import { HealthCheckService } from './health-check.service.js';

@Controller('system/health')
export class SystemHealthController {
  constructor(@Inject(HealthCheckService) private readonly service: HealthCheckService) {}

  @Public()
  @Get()
  status(): Promise<{ status: 'ok' }> {
    return this.service.status();
  }
}
