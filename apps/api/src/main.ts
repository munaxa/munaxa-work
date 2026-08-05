import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadProcessEnvironment } from '@work/config';

import { AppModule } from './app.module.js';
import { configureApplication, configureOpenApi } from './application.setup.js';

const bootstrap = async (): Promise<void> => {
  const environment = loadProcessEnvironment();
  const application = await NestFactory.create(AppModule, { bufferLogs: true });

  application.useLogger(application.get(Logger));
  configureApplication(application, environment);

  if (environment.OPENAPI_ENABLED) {
    configureOpenApi(application, environment);
  }

  await application.listen(environment.PORT, environment.HOST);
};

// The composition root is the only place a startup failure is handled. It exits non-zero so an
// orchestrator restarts or rolls back, rather than leaving a process alive but not serving.
bootstrap().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
