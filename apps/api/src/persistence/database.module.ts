import { Logger, Module, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PostgresUnitOfWork, assertIsolationEnforced } from '@work/persistence';
import { InProcessEventDispatcher, type EventDispatcher, type UnitOfWork } from '@work/kernel';
import type { Environment } from '@work/config';

import { ENVIRONMENT, environmentProvider } from '../configuration/environment.provider.js';

export const DATABASE_POOL = Symbol('DATABASE_POOL');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const EVENT_DISPATCHER = Symbol('EVENT_DISPATCHER');

/**
 * The database, and the startup check that must pass before this application serves anything.
 *
 * The isolation assertion runs in `onModuleInit`, which means a database that cannot enforce
 * tenant isolation stops the process rather than producing a running application that leaks
 * quietly (ADR-0030).
 */
@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseLifecycle.name);

  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async onModuleInit(): Promise<void> {
    const diagnostics = await assertIsolationEnforced(this.pool);

    this.logger.log(
      `Tenant isolation enforced: connected as "${diagnostics.role}", which cannot bypass row-level security.`,
    );
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Module({
  providers: [
    environmentProvider,
    {
      provide: DATABASE_POOL,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): Pool =>
        new Pool({
          connectionString: environment.DATABASE_URL,
          max: environment.DATABASE_POOL_SIZE,
        }),
    },
    {
      provide: EVENT_DISPATCHER,
      useFactory: (): EventDispatcher => new InProcessEventDispatcher(),
    },
    {
      provide: UNIT_OF_WORK,
      inject: [DATABASE_POOL, EVENT_DISPATCHER],
      useFactory: (pool: Pool, dispatcher: EventDispatcher): UnitOfWork =>
        new PostgresUnitOfWork(pool, dispatcher),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_POOL, UNIT_OF_WORK, EVENT_DISPATCHER],
})
export class DatabaseModule {}
