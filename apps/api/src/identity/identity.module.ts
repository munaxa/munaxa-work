import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PinoLogger } from 'nestjs-pino';
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
  GrantAwarePermissionChecker,
  ModuleRegistry,
  UnauthenticatedPort,
  type EventDispatcher,
  type PermissionChecker,
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
import { DeferredPeopleSender, peopleModuleFor } from '../people/people.composition.js';
import {
  DeferredEmploymentSender,
  employmentModuleFor,
} from '../employment/employment.composition.js';
import { assignmentFilledHeadcount, postgresEmploymentStores } from '@work/employment';
import {
  DeferredRecruitmentSender,
  recruitmentModuleFor,
} from '../recruitment/recruitment.composition.js';
import {
  DeferredOnboardingSender,
  onboardingModuleFor,
} from '../onboarding/onboarding.composition.js';
import {
  DeferredAttendanceSender,
  attendanceModuleFor,
} from '../attendance/attendance.composition.js';
import { DeferredLeaveDispatcher, leaveModuleFor } from '../leave/leave.composition.js';
import {
  DeferredCompensationDispatcher,
  compensationModuleFor,
} from '../compensation/compensation.composition.js';
import { DeferredPayrollDispatcher, payrollModuleFor } from '../payroll/payroll.composition.js';
import { documentsModuleFor } from '../documents/documents.composition.js';
import { lettersModuleFor } from '../letters/letters.composition.js';
import { performanceModuleFor } from '../performance/performance.composition.js';
import { learningModuleFor } from '../learning/learning.composition.js';
import { careerModuleFor } from '../career/career.composition.js';
import { workflowModuleFor } from '../workflow/workflow.composition.js';

import {
  AUTHENTICATION_PORT,
  DEFERRED_SENDERS,
  DISPATCHER,
  MEMBERSHIP_DIRECTORY,
  MODULE_REGISTRY,
  PEOPLE_MODULE,
  PERMISSION_AWARE_MODULES,
  PERMISSION_CHECKER,
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
      provide: DEFERRED_SENDERS,
      useFactory: (): DeferredSenders => ({
        organization: new DeferredCommandSender(),
        people: new DeferredPeopleSender(),
        employment: new DeferredEmploymentSender(),
        recruitment: new DeferredRecruitmentSender(),
        onboarding: new DeferredOnboardingSender(),
        attendance: new DeferredAttendanceSender(),
        leave: new DeferredLeaveDispatcher(),
        compensation: new DeferredCompensationDispatcher(),
        payroll: new DeferredPayrollDispatcher(),
      }),
    },
    {
      // One checker, given to the pipeline *and* to People's reads. Two would eventually differ,
      // and the difference would be a caller redacted by one and not the other.
      //
      // It is wrapped, not replaced. `GrantAwarePermissionChecker` consults Platform first and adds
      // only the narrow, named authority a module holds while acting inside another under a bounded
      // service grant (ADR-0043) — and adds nothing at all when no grant is open. Every elevation is
      // logged with the operation that caused it and the human it was for, so "what did Recruitment
      // do inside People, and for whom" is a question the logs answer.
      provide: PERMISSION_CHECKER,
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger): PermissionChecker =>
        new GrantAwarePermissionChecker(new PlatformPermissionChecker(), (elevation) => {
          logger.logger.info({ elevation }, 'service grant elevated a cross-module permission');
        }),
    },
    {
      provide: PEOPLE_MODULE,
      inject: [UNIT_OF_WORK, PERMISSION_CHECKER, ENVIRONMENT, PinoLogger, DEFERRED_SENDERS],
      useFactory: (
        unitOfWork: UnitOfWork,
        permissions: PermissionChecker,
        environment: Environment,
        logger: PinoLogger,
        senders: DeferredSenders,
      ): WorkModule =>
        peopleModuleFor(unitOfWork, permissions, environment, logger.logger, senders.people),
    },
    {
      provide: PERMISSION_AWARE_MODULES,
      inject: [UNIT_OF_WORK, PERMISSION_CHECKER, DEFERRED_SENDERS, PEOPLE_MODULE],
      useFactory: (
        unitOfWork: UnitOfWork,
        permissions: PermissionChecker,
        senders: DeferredSenders,
        people: WorkModule,
      ): PermissionAwareModules => ({
        people,
        documents: documentsModuleFor(unitOfWork, senders.payroll, permissions),
        letters: lettersModuleFor(unitOfWork, senders.payroll, permissions),
        performance: performanceModuleFor(unitOfWork, senders.payroll, permissions),
        learning: learningModuleFor(unitOfWork, senders.payroll, permissions),
        career: careerModuleFor(unitOfWork, senders.payroll, permissions),
        workflow: workflowModuleFor(unitOfWork, senders.payroll, senders.recruitment, permissions),
      }),
    },
    {
      provide: MODULE_REGISTRY,
      inject: [
        UNIT_OF_WORK,
        DATABASE_POOL,
        ENVIRONMENT,
        DEFERRED_SENDERS,
        PERMISSION_AWARE_MODULES,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        pool: Pool,
        environment: Environment,
        senders: DeferredSenders,
        permissionAware: PermissionAwareModules,
      ): ModuleRegistry => {
        const registry = new ModuleRegistry();

        registry.register(identityModuleFor(unitOfWork, pool, environment));
        // Organization is registered with Employment's filled-headcount adapter rather than
        // `NoAssignmentsYet`: the port Phase 3 declared for exactly this, used as designed. Nothing
        // in Organization changes — the composition root chooses the implementation, and the
        // establishment's `filled` figure stops being zero because there are now assignments to
        // count.
        registry.register(
          organizationModuleFor(
            unitOfWork,
            senders.organization,
            assignmentFilledHeadcount(unitOfWork, postgresEmploymentStores()),
          ),
        );
        registry.register(permissionAware.people);
        registry.register(employmentModuleFor(unitOfWork, senders.employment));
        registry.register(recruitmentModuleFor(unitOfWork, senders.recruitment));
        registry.register(onboardingModuleFor(unitOfWork, senders.onboarding));
        registry.register(attendanceModuleFor(unitOfWork, senders.attendance));
        // Leave is registered after Attendance, and the order is not arbitrary: Attendance's leave
        // adapter asks Leave's published read, and Leave's working-day adapter asks Attendance's.
        // Both go through the one dispatcher assembled below, so neither module imports the other.
        registry.register(leaveModuleFor(unitOfWork, senders.leave));
        // Compensation is registered last. It reads Employment and Organization and is read by
        // nobody in this repository yet — Payroll (Phase 11) is its first consumer, and it will
        // pull through `compensation.payroll-period` rather than being pushed to.
        registry.register(compensationModuleFor(unitOfWork, senders.compensation));
        // Payroll is registered last, and reads all five modules above through their published
        // queries under bounded service grants. Nothing pushes to it: a payroll run pulls what it
        // needs and reconciles by asking again, so a lost event costs nothing (ADR-0064).
        registry.register(payrollModuleFor(unitOfWork, senders.payroll));
        // Documents and Letters read People, Employment, Organization and Compensation through
        // their published queries under bounded service grants, and are read by nobody. Both take
        // the permission checker as well as the pipeline's, because both assemble an answer from
        // what the caller holds: Documents withholds confidential documents from a caller without
        // `document.read-sensitive`, and Letters refuses a salary template to an issuer without
        // `letter.include-salary`.
        registry.register(permissionAware.documents);
        // Letters last. It reads the same four modules and, unlike every other module here, has a
        // capability it cannot perform: nothing renders a document, so an issued letter carries its
        // content and no artefact (D-15).
        registry.register(permissionAware.letters);
        // Performance last. It reads Employment, Organization and Documents through their published
        // queries under bounded service grants, and is read by nobody: Compensation, Learning and
        // Career pull a rating when they want one. It takes the permission checker as well as the
        // pipeline's because its reads are scoped by what the caller holds — HR reading the
        // organization and a manager reading their own reports take different paths through the
        // same query, and the handler has to ask which one it is holding.
        registry.register(permissionAware.performance);
        // Learning last. It reads Employment, Organization and Documents through their published
        // queries under bounded service grants, and writes to none of them: what somebody attained
        // is this module's record, and Performance or Career pulls it when it wants one (AD-005).
        // It takes the permission checker as well as the pipeline's because its reads are scoped by
        // what the caller holds — and because `assignment.read-team` deliberately resolves to
        // nothing until the platform can say which employment the caller is (ADR-0032).
        registry.register(permissionAware.learning);
        // Career last of all, because it reads the three modules above it and is read by none of
        // them. Employment, Organization and Learning are consumed through their published queries
        // under bounded service grants, and Career writes to none of them — nor to Performance,
        // Compensation or People, for which it declares no adapter at all (ADR-0072). It takes the
        // permission checker for the same reason Learning does: `plan.read-team` resolves to
        // nothing until the platform can say which employment the caller is (ADR-0032).
        registry.register(permissionAware.career);
        // Workflow last of all, and it reads exactly one module: Identity, for the delegation
        // register it deliberately does not duplicate (AD-010, D-2). It writes to nothing outside
        // itself — the seam through which an approval reaches an adopting module is Checkpoint 7 —
        // and it is read by nobody yet. It takes the permission checker for the same reason
        // Career and Learning do, and for one they do not: `workflow.approval.read-own` is the
        // first `read-own` in this repository that actually routes, because an approval is
        // addressed to a membership and the request has already resolved one (Checkpoint 4).
        registry.register(permissionAware.workflow);
        return registry;
      },
    },
    {
      provide: DISPATCHER,
      inject: [MODULE_REGISTRY, EVENT_DISPATCHER, DEFERRED_SENDERS, PERMISSION_CHECKER],
      useFactory: (
        registry: ModuleRegistry,
        events: EventDispatcher,
        senders: DeferredSenders,
        permissions: PermissionChecker,
      ): Dispatcher => {
        const dispatcher = new Dispatcher(permissions);

        for (const module of registry.registered) {
          for (const handler of module.commands ?? []) {
            dispatcher.registerCommand(handler);
          }
          for (const handler of module.queries ?? []) {
            dispatcher.registerQuery(handler);
          }
          for (const handler of module.eventHandlers ?? []) events.register(handler);
        }
        senders.organization.attach(dispatcher);
        senders.people.attach(dispatcher);
        senders.employment.attach(dispatcher);
        senders.recruitment.attach(dispatcher);
        senders.onboarding.attach(dispatcher);
        senders.attendance.attach(dispatcher);
        senders.leave.attach(dispatcher);
        senders.compensation.attach(dispatcher);
        senders.payroll.attach(dispatcher);
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
 * The senders that are handed their dispatcher once it exists.
 *
 * One object rather than four providers, so the factories that need them stay inside the
 * five-parameter budget — a list any longer is one somebody eventually passes in the wrong order.
 */
interface PermissionAwareModules {
  readonly people: WorkModule;
  readonly documents: WorkModule;
  readonly letters: WorkModule;
  readonly performance: WorkModule;
  readonly learning: WorkModule;
  readonly career: WorkModule;
  readonly workflow: WorkModule;
}

interface DeferredSenders {
  readonly organization: DeferredCommandSender;
  readonly people: DeferredPeopleSender;
  readonly employment: DeferredEmploymentSender;
  readonly recruitment: DeferredRecruitmentSender;
  readonly onboarding: DeferredOnboardingSender;
  readonly attendance: DeferredAttendanceSender;
  readonly leave: DeferredLeaveDispatcher;
  readonly compensation: DeferredCompensationDispatcher;
  readonly payroll: DeferredPayrollDispatcher;
}

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
