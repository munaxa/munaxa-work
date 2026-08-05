import { Module } from '@nestjs/common';

import { environmentProvider } from '../configuration/environment.provider.js';
import { DatabaseModule } from '../persistence/database.module.js';

import { HealthController } from './health.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [environmentProvider],
})
export class HealthModule {}
