import { Module } from '@nestjs/common';

import { environmentProvider } from '../configuration/environment.provider.js';

import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [environmentProvider],
})
export class HealthModule {}
