import { SetMetadata, type CustomDecorator } from '@nestjs/common';

/** Metadata key the tenant guard reads. */
export const PRINCIPAL_ROUTE = 'work:principal-route';

/**
 * Marks a route as needing an authenticated principal and **no** tenant.
 *
 * Narrower than `@PublicRoute()`, which needs neither. There is one legitimate use: listing which
 * tenants the caller may act in (`GET /session/tenants`), which is the question a tenant must be
 * chosen *from*, so it cannot itself require one. A caller with no principal is still refused with
 * 401 here, and nothing such a route returns may be tenant data: there is no tenant context, and
 * row-level security returns nothing without one.
 */
export const PrincipalRoute = (): CustomDecorator<string> => SetMetadata(PRINCIPAL_ROUTE, true);
