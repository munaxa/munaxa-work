import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadProcessEnvironment } from '@work/config';

import { environmentProvider } from './configuration/environment.provider.js';
import { HealthModule } from './health/health.module.js';
import { CorrelationMiddleware } from './observability/correlation.middleware.js';
import { TenantMiddleware } from './tenancy/tenant.middleware.js';
import { loggingOptions } from './observability/logging.js';

/**
 * The composition root. Module registration becomes automatic in Phase 1; until then the only
 * module is health, and no business module exists to register.
 */
@Module({
  imports: [LoggerModule.forRoot(loggingOptions(loadProcessEnvironment())), HealthModule],
  providers: [environmentProvider],
  exports: [environmentProvider],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    // Order matters: correlation first, so the tenant context can carry its identifier.
    consumer.apply(CorrelationMiddleware, TenantMiddleware).forRoutes('*splat');
  }
}
