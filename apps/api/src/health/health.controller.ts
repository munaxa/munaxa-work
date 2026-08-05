import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Environment } from '@work/config';

import { ENVIRONMENT } from '../configuration/environment.provider.js';

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
  public constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'The process is running.' })
  public live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiOkResponse({ description: 'The application can serve traffic.' })
  public ready(): LivenessResponse {
    // Phase 1 adds the database and cache checks that make this meaningful. Until a dependency
    // exists, readiness and liveness are the same question honestly answered.
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Application health and build information' })
  @ApiOkResponse({ description: 'Health, version and dependency status.' })
  public health(): HealthResponse {
    return {
      status: 'ok',
      service: this.environment.APP_NAME,
      version: this.environment.APP_VERSION,
      build: this.environment.BUILD_SHA,
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies: {
        database: 'not-configured',
        cache: this.environment.REDIS_URL === undefined ? 'not-configured' : 'up',
      },
    };
  }
}
