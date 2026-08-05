import { RequestMethod, ValidationPipe, VersioningType } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Environment } from '@work/config';

import { ProblemDetailsFilter } from './errors/problem-details.filter.js';

/**
 * Everything that turns a Nest application into *this* application: the error contract, input
 * validation, the versioned prefix, and OpenAPI.
 *
 * It lives here rather than inline in `main.ts` so the tests can assert the real composition.
 * A test that configures the application slightly differently from production proves nothing
 * about production — and routing, prefixes and global filters are exactly where that gap hides.
 */
export const configureApplication = (
  application: INestApplication,
  environment: Environment,
): void => {
  application.useGlobalFilters(new ProblemDetailsFilter());
  application.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Health probes stay unprefixed and unversioned: an orchestrator's probe URL must not change
  // when the API version does.
  application.setGlobalPrefix(environment.API_PREFIX, {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/*splat', method: RequestMethod.ALL },
    ],
  });
  application.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  application.enableShutdownHooks();
};

/** Publishes OpenAPI at `<prefix>/docs`. Separate because a deployment may disable it. */
export const configureOpenApi = (application: INestApplication, environment: Environment): void => {
  const document = SwaggerModule.createDocument(
    application,
    new DocumentBuilder()
      .setTitle('Munaxa Work API')
      .setDescription('Enterprise Human Capital Management.')
      .setVersion(environment.APP_VERSION)
      .build(),
  );

  SwaggerModule.setup(`${environment.API_PREFIX}/docs`, application, document);
};
