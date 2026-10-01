import { Module } from '@nestjs/common';
import { HealthCheckService } from './health-check.service.js';
import { SystemHealthController } from './system-health.controller.js';

@Module({
  controllers: [SystemHealthController],
  providers: [HealthCheckService],
})
export class SysModule {}
