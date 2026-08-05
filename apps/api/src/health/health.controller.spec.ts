import type { Server } from 'node:http';

import { Controller, Get, HttpException, HttpStatus, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadEnvironment, type Environment } from '@work/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { ENVIRONMENT } from '../configuration/environment.provider.js';
import type { ProblemDetails } from '../errors/problem-details.filter.js';
import { CorrelationMiddleware } from '../observability/correlation.middleware.js';

import type { HealthResponse, LivenessResponse } from './health.controller.js';
import { HealthController } from './health.controller.js';

/** Exercises the error contract without waiting for a business endpoint to exist. */
@Controller('failing')
class FailingController {
  @Get('expected')
  public expected(): never {
    throw new HttpException('Nothing matches that identifier.', HttpStatus.NOT_FOUND);
  }

  @Get('unexpected')
  public unexpected(): never {
    throw new Error('connection to postgres://user:secret@db failed');
  }
}

const testEnvironment: Environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

@Module({
  controllers: [HealthController, FailingController],
  providers: [{ provide: ENVIRONMENT, useValue: testEnvironment }],
})
class TestModule {}

describe('health and error contract', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    const middleware = new CorrelationMiddleware();

    app = moduleRef.createNestApplication();
    app.use(middleware.use.bind(middleware));
    configureApplication(app, testEnvironment);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers liveness', async () => {
    const response = await request(server()).get('/health/live').expect(200);

    expect(response.body as LivenessResponse).toEqual({ status: 'ok' });
  });

  it('answers readiness', async () => {
    const response = await request(server()).get('/health/ready').expect(200);

    expect(response.body as LivenessResponse).toEqual({ status: 'ok' });
  });

  it('reports build information and dependency status', async () => {
    const response = await request(server()).get('/health').expect(200);
    const health = response.body as HealthResponse;

    expect(health.status).toBe('ok');
    expect(health.service).toBe('munaxa-work-test');
    expect(health.version).toBe('0.0.0-test');
    expect(health.dependencies.database).toEqual(expect.any(String));
    expect(health.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('assigns a request id and echoes it', async () => {
    const response = await request(server()).get('/health/live').expect(200);

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-correlation-id']).toBe(response.headers['x-request-id']);
  });

  it('propagates a caller supplied correlation id', async () => {
    const response = await request(server())
      .get('/health/live')
      .set('x-correlation-id', 'caller-correlation')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('caller-correlation');
    expect(response.headers['x-request-id']).not.toBe('caller-correlation');
  });

  it('returns problem details for a deliberate error', async () => {
    const response = await request(server()).get('/api/v1/failing/expected').expect(404);
    const problem = response.body as ProblemDetails;

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(problem.type).toBe('about:blank');
    expect(problem.title).toBe('Not Found');
    expect(problem.status).toBe(404);
    expect(problem.detail).toBe('Nothing matches that identifier.');
    expect(problem.instance).toBe('/api/v1/failing/expected');
    expect(problem.requestId).toBeDefined();
  });

  it('keeps health probes unprefixed and unversioned, so probe urls survive a version bump', async () => {
    await request(server()).get('/health/live').expect(200);
    await request(server()).get('/api/v1/health/live').expect(404);
  });

  it('serves business routes under the versioned prefix', async () => {
    await request(server()).get('/api/v1/failing/expected').expect(404);
    await request(server()).get('/failing/expected').expect(404);
  });

  it('never leaks internal detail from an unexpected error', async () => {
    const response = await request(server()).get('/api/v1/failing/unexpected').expect(500);
    const problem = response.body as ProblemDetails;
    const serialized = JSON.stringify(problem);

    expect(serialized).not.toContain('postgres');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('stack');
    expect(problem.detail).toBe('An unexpected error occurred.');
  });
});
