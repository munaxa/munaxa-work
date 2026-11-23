import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';

import { SessionTenantsController } from './session-tenants.controller.js';

/**
 * The caller's own session, before a tenant is chosen: which tenants they may act in (MW-007).
 *
 * Its own module so that the one principal-only route sits apart from every tenant-scoped one, and
 * reads the membership directory the identity module already builds rather than a second copy.
 */
@Module({
  imports: [IdentityModule],
  controllers: [SessionTenantsController],
})
export class SessionModule {}
