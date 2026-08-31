import type { Provider } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Environment } from '@work/config';
import {
  GrantAwarePermissionChecker,
  UnauthenticatedPort,
  type PermissionChecker,
  type PlatformAuthenticationPort,
} from '@work/kernel';
import type { Pool } from 'pg';

import { DATABASE_POOL } from '../persistence/database.module.js';
import { ENVIRONMENT } from '../configuration/environment.provider.js';

import { WorkAuthorization } from './authorization.js';
import { AUTHENTICATION_PORT, AUTHORIZATION, PERMISSION_CHECKER } from './identity.tokens.js';
import { PlatformPermissionChecker } from './permission-checker.js';
import { authenticationFor } from './platform-authentication.js';

/**
 * The three providers that make up the security boundary, in one file.
 *
 * Together rather than scattered through the composition root because they are one decision: who
 * the caller is, what the tenant has granted them, and who decides. Reading them beside each other
 * is how somebody can tell in a minute that Munaxa Work verifies nothing and grants nothing —
 * Platform's adapter authenticates, Platform's resolver decides, and this repository supplies the
 * rows and the seam.
 */

/**
 * Platform's relying-party adapter, or the one that authenticates nobody.
 *
 * A deployment with no issuer configured answers 401 to every business request, which is noticed
 * on the first one. Configuration refuses that state outright in production, so the fallback is
 * reachable only in a development checkout that has not been given an issuer.
 */
export const authenticationProvider: Provider = {
  provide: AUTHENTICATION_PORT,
  inject: [ENVIRONMENT],
  useFactory: (environment: Environment): PlatformAuthenticationPort =>
    authenticationFor(environment) ?? new UnauthenticatedPort(),
};

/**
 * Work's authorization: the tenant's stored assignments, and Platform's resolver over them.
 *
 * One instance, because the resolver memoises each tenant's role graph and a second would hold a
 * copy that nothing invalidates — a role narrowed through one and still conferring its old grants
 * through the other.
 */
export const authorizationProvider: Provider = {
  provide: AUTHORIZATION,
  inject: [DATABASE_POOL, PinoLogger],
  useFactory: (pool: Pool, logger: PinoLogger): WorkAuthorization =>
    new WorkAuthorization(pool, (detail) => {
      // A grant the resolver could not represent was dropped. The operator configured something
      // that does not do what it reads as, and resolution succeeding quietly is how that survives.
      logger.logger.warn({ detail }, 'a role grant could not be represented and was dropped');
    }),
};

/**
 * One checker, given to the pipeline *and* to the modules whose reads are scoped by what the
 * caller holds. Two would eventually differ, and the difference would be a caller redacted by one
 * and not the other.
 *
 * It is wrapped, not replaced. `GrantAwarePermissionChecker` consults Platform first and adds only
 * the narrow, named authority a module holds while acting inside another under a bounded service
 * grant (ADR-0043) — and adds nothing at all when no grant is open. Every elevation is logged with
 * the operation that caused it and the human it was for, so "what did Recruitment do inside
 * People, and for whom" is a question the logs answer.
 */
export const permissionCheckerProvider: Provider = {
  provide: PERMISSION_CHECKER,
  inject: [PinoLogger, AUTHORIZATION],
  useFactory: (logger: PinoLogger, authorization: WorkAuthorization): PermissionChecker =>
    new GrantAwarePermissionChecker(new PlatformPermissionChecker(authorization), (elevation) => {
      logger.logger.info({ elevation }, 'service grant elevated a cross-module permission');
    }),
};
