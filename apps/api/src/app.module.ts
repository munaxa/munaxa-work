import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { loadProcessEnvironment } from '@work/config';

import { environmentProvider } from './configuration/environment.provider.js';
import { DatabaseModule } from './persistence/database.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { PeopleModule } from './people/people.module.js';
import { EmploymentModule } from './employment/employment.module.js';
import { CorrelationMiddleware } from './observability/correlation.middleware.js';
import { AuthenticatedTenantGuard } from './tenancy/authenticated-tenant.guard.js';
import { TenantMiddleware } from './tenancy/tenant.middleware.js';
import { loggingOptions } from './observability/logging.js';

/**
 * The composition root.
 *
 * Business modules register themselves through the module registry, which derives their
 * permissions, navigation and health from what they declare — see `identity.module.ts` for the
 * shape every later module follows.
 */
@Module({
  imports: [
    LoggerModule.forRoot(loggingOptions(loadProcessEnvironment())),
    DatabaseModule,
    IdentityModule,
    OrganizationModule,
    PeopleModule,
    EmploymentModule,
    HealthModule,
  ],
  providers: [
    environmentProvider,
    {
      // Guards run before pipes, so this is what keeps "authorization before validation" true
      // at the transport as well as inside the CQRS pipeline. Routes that are legitimately
      // reachable without a tenant say so with `@PublicRoute()`; everything else is guarded by
      // default, which is the direction that fails closed.
      provide: APP_GUARD,
      useClass: AuthenticatedTenantGuard,
    },
  ],
  exports: [environmentProvider],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    // Order matters twice over: correlation first, so the tenant context can carry its
    // identifier; and the tenant middleware before every route, so nothing downstream can run
    // without having been through authentication and membership resolution.
    consumer.apply(CorrelationMiddleware, TenantMiddleware).forRoutes('*splat');
  }
}
