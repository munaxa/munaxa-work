import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import {
  IdentityDispatcher,
  InvitationsController,
  DelegationController,
  EmploymentLinkController,
  PortalAccessController,
  MemberProfileController,
  MembersController,
  PostgresMembershipDirectory,
  identityModule,
  postgresIdentityStores,
  systemClock,
  type TenantMembershipDirectory,
} from '@work/identity';
import { StoredTenantSettings } from '@work/organization';
import {
  Dispatcher,
  ModuleRegistry,
  UnauthenticatedPort,
  type EventDispatcher,
  type PlatformAuthenticationPort,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import type { Environment } from '@work/config';

import { ENVIRONMENT, environmentProvider } from '../configuration/environment.provider.js';
import {
  DATABASE_POOL,
  DatabaseModule,
  EVENT_DISPATCHER,
  UNIT_OF_WORK,
} from '../persistence/database.module.js';

import {
  DeferredCommandSender,
  organizationModuleFor,
} from '../organization/organization.composition.js';

import {
  AUTHENTICATION_PORT,
  COMMAND_SENDER,
  DISPATCHER,
  MEMBERSHIP_DIRECTORY,
  MODULE_REGISTRY,
} from './identity.tokens.js';
import { PlatformPermissionChecker } from './permission-checker.js';

/**
 * The composition root for Workforce Identity, and for module registration generally.
 *
 * The pattern here is the one every later module follows: build the module's dependencies,
 * register it, and let the registry derive permissions, navigation and health from what it
 * declared. Nothing is registered by hand, because a permission that exists in code but not in
 * the administration screen is invisible until a customer finds it.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    MembersController,
    InvitationsController,
    DelegationController,
    EmploymentLinkController,
    PortalAccessController,
    MemberProfileController,
  ],
  providers: [
    environmentProvider,
    {
      // Platform's adapter replaces this in a deployment that has one. Until then it
      // authenticates nobody, which is the only safe default for a port this product does not
      // own — see `UnauthenticatedPort`.
      provide: AUTHENTICATION_PORT,
      useFactory: (): PlatformAuthenticationPort => new UnauthenticatedPort(),
    },
    {
      provide: MEMBERSHIP_DIRECTORY,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool): TenantMembershipDirectory => new PostgresMembershipDirectory(pool),
    },
    {
      // Built once and handed the dispatcher below, which is the only way to give bulk import a
      // dispatcher assembled from a list that includes bulk import.
      provide: COMMAND_SENDER,
      useFactory: (): DeferredCommandSender => new DeferredCommandSender(),
    },
    {
      provide: MODULE_REGISTRY,
      inject: [UNIT_OF_WORK, DATABASE_POOL, ENVIRONMENT, COMMAND_SENDER],
      useFactory: (
        unitOfWork: UnitOfWork,
        pool: Pool,
        environment: Environment,
        sender: DeferredCommandSender,
      ): ModuleRegistry => {
        const registry = new ModuleRegistry();

        registry.register(identityModuleFor(unitOfWork, pool, environment));
        registry.register(organizationModuleFor(unitOfWork, sender));
        return registry;
      },
    },
    {
      provide: DISPATCHER,
      inject: [MODULE_REGISTRY, EVENT_DISPATCHER, COMMAND_SENDER],
      useFactory: (
        registry: ModuleRegistry,
        events: EventDispatcher,
        sender: DeferredCommandSender,
      ): Dispatcher => {
        const dispatcher = new Dispatcher(new PlatformPermissionChecker());

        for (const module of registry.registered) {
          for (const handler of module.commands ?? []) {
            dispatcher.registerCommand(handler);
          }
          for (const handler of module.queries ?? []) {
            dispatcher.registerQuery(handler);
          }
          for (const handler of module.eventHandlers ?? []) events.register(handler);
        }
        sender.attach(dispatcher);
        return dispatcher;
      },
    },
    {
      provide: IdentityDispatcher,
      inject: [DISPATCHER],
      useFactory: (dispatcher: Dispatcher): IdentityDispatcher =>
        new IdentityDispatcher(dispatcher),
    },
  ],
  exports: [AUTHENTICATION_PORT, MEMBERSHIP_DIRECTORY, DISPATCHER, MODULE_REGISTRY],
})
export class IdentityModule {}

/**
 * The tenant's identity defaults now come from *that tenant*, falling back to the deployment's
 * validated configuration for a tenant that has configured none.
 *
 * This one substitution is the outward shape of the Phase 2 debt being closed. `StoredTenantSettings`
 * is Organization's adapter for the port Identity already asked through, so Identity's use cases
 * did not change — which is the evidence the port was drawn in the right place (ADR-0036).
 *
 * Nothing about a country, a calendar or a language is written here (00B).
 */
const identityModuleFor = (
  unitOfWork: UnitOfWork,
  pool: Pool,
  environment: Environment,
): WorkModule =>
  identityModule({
    unitOfWork,
    stores: postgresIdentityStores(),
    settings: new StoredTenantSettings(pool, {
      language: environment.DEFAULT_LOCALE,
      calendar: environment.DEFAULT_CALENDAR,
      timeZone: environment.DEFAULT_TIME_ZONE,
      numerals: environment.DEFAULT_NUMERALS,
      invitationValidityDays: environment.INVITATION_VALIDITY_DAYS,
      defaultPortals: environment.DEFAULT_PORTALS,
    }),
    clock: systemClock,
  });
