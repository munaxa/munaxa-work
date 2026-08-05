import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Environment } from '@work/config';
import { checkDatabase } from '@work/persistence';
import type { Pool } from 'pg';

import { ENVIRONMENT } from '../configuration/environment.provider.js';
import { DATABASE_POOL } from '../persistence/database.module.js';

/**
 * Liveness, readiness and health, as three distinct questions:
 *
 *   /live   — is the process running? An orchestrator restarts it if not.
 *   /ready  — can it serve traffic? An orchestrator withholds traffic if not.
 *   /health — what is the state of the application and its dependencies?
 *
 * Conflating them causes an orchestrator to kill a process that is merely waiting for a
 * dependency. These endpoints are unauthenticated by design and expose no configuration.
 */
export interface LivenessResponse {
  readonly status: 'ok';
}

export interface HealthResponse {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly version: string;
  readonly build: string;
  readonly uptimeSeconds: number;
  readonly dependencies: Readonly<Record<string, 'up' | 'down' | 'not-configured'>>;
}

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  public constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    @Inject(DATABASE_POOL) private readonly pool: Pool,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'The process is running.' })
  public live(): LivenessResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness depends on the database, because an application that cannot reach it can accept
   * a request but cannot answer one. Reporting ready regardless is how an orchestrator routes
   * traffic into a process that will only return errors.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ description: 'The application can serve traffic.' })
  public async ready(): Promise<LivenessResponse> {
    const database = await checkDatabase(this.pool);

    if (database.status === 'down') {
      throw new ServiceUnavailableException('Not ready: the database is unreachable.');
    }
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Application health and build information' })
  @ApiOkResponse({ description: 'Health, version and dependency status.' })
  public async health(): Promise<HealthResponse> {
    const database = await checkDatabase(this.pool);

    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      service: this.environment.APP_NAME,
      version: this.environment.APP_VERSION,
      build: this.environment.BUILD_SHA,
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: {
        database: database.status,
        cache: this.environment.REDIS_URL === undefined ? 'not-configured' : 'up',
      },
    };
  }
}
