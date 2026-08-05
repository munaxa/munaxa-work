import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key the tenant guard reads. */
export const PUBLIC_ROUTE = 'work:public-route';

/**
 * Marks a route as reachable without an authenticated principal or a tenant.
 *
 * The direction matters: the guard requires a tenant by default and this is the exemption, so
 * forgetting the decorator leaves an endpoint guarded rather than open. The opposite arrangement
 * — mark the ones that need protecting — fails open on exactly the endpoint somebody forgot.
 *
 * There is presently one legitimate use: the health probes, which an orchestrator calls with no
 * credentials by design. Adding a second is a decision, not a convenience.
 */
export const PublicRoute = (): CustomDecorator<string> => SetMetadata(PUBLIC_ROUTE, true);
