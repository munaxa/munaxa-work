export {
  environmentSchema,
  loadEnvironment,
  loadProcessEnvironment,
  platformAuthenticationFrom,
  ConfigurationError,
} from './environment.js';
export type { Environment } from './environment.js';
export {
  readPlatformAuthentication,
  PLATFORM_AUTHENTICATION_ALGORITHMS,
} from './platform-authentication.js';
export type {
  PlatformAuthentication,
  PlatformAuthenticationAlgorithm,
  PlatformAuthenticationConfiguration,
  PlatformVerificationKey,
} from './platform-authentication.js';
export {
  portalEnvironmentSchema,
  loadPortalEnvironment,
  loadPortalProcessEnvironment,
} from './portal-environment.js';
export type { PortalEnvironment } from './portal-environment.js';
