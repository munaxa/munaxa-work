import { loadProcessEnvironment, type Environment } from '@work/config';
import type { Provider } from '@nestjs/common';

/** Injection token for the validated environment. Nothing else reads `process.env`. */
export const ENVIRONMENT = Symbol('ENVIRONMENT');

/**
 * Validates the environment once, at the composition root. An invalid environment fails
 * startup here rather than surfacing as a confusing error on the first request.
 */
export const environmentProvider: Provider = {
  provide: ENVIRONMENT,
  useFactory: (): Environment => loadProcessEnvironment(),
};
