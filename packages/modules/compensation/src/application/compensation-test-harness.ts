import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { compensationModule } from './compensation-module.js';
import { inMemoryCompensationStores } from './in-memory-definitions.js';
import { ALL_COMPENSATION_PERMISSIONS } from './compensation-permissions.js';
import type { CompensationStores } from './compensation-ports.js';
import type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForCompensation,
  GoverningEntity,
  OrganizationDirectoryPort,
} from './cross-module-ports.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The harness every application suite in this module builds on, and the two cross-module fakes.
 *
 * The fakes are **exported from the package**, deliberately and under names that cannot be mistaken
 * for production code: the API's endpoint tests need the same stores and the same fakes this
 * module's own tests use, and a fake duplicated in two packages is a fake that will drift from the
 * real thing in one of them.
 *
 * `FakeOrganization` answers `known: false` **until it is told otherwise**, which is the honest
 * default. A fake that invented a legal entity and a currency by default would make every currency
 * test pass against a jurisdiction no customer configured.
 */

export class FakeEmployment implements EmploymentDirectoryPort {
  private readonly employments = new Map<string, EmploymentForCompensation>();

  public add(employment: EmploymentForCompensation): string {
    this.employments.set(employment.employmentId, employment);
    return employment.employmentId;
  }

  /** A serviceable employment with sensible dates, for a test that does not care about them. */
  public addOne(overrides: Partial<EmploymentForCompensation> = {}): string {
    return this.add({
      employmentId: overrides.employmentId ?? uuidV7(),
      status: 'active',
      startDate: '2020-01-01',
      ...overrides,
    });
  }

  public find(employmentId: string): Promise<EmploymentForCompensation | undefined> {
    return Promise.resolve(this.employments.get(employmentId));
  }

  public activeEmployments(limit: number): Promise<readonly EmploymentForCompensation[]> {
    return Promise.resolve([...this.employments.values()].slice(0, limit));
  }
}

/**
 * Organization's legal-entity read, faked.
 *
 * Starts as **unknown**, so a suite that forgets to configure an entity gets the honest answer
 * rather than a silently invented currency.
 */
export class FakeOrganization implements OrganizationDirectoryPort {
  private answer: GoverningEntity = { known: false };

  public governs(unitId: string, countryCode: string, currencyCode: string): void {
    this.answer = {
      known: true,
      entity: { legalEntityId: unitId, countryCode, currencyCode },
    };
  }

  public unknown(): void {
    this.answer = { known: false };
  }

  public governingLegalEntity(): Promise<GoverningEntity> {
    return Promise.resolve(this.answer);
  }
}

/** A clock that does not move unless a test moves it. */
export class FixedClock implements Clock {
  public constructor(private instant: Date) {}

  public now(): Date {
    return this.instant;
  }

  public set(instant: Date): void {
    this.instant = instant;
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly stores: CompensationStores;
  readonly employment: FakeEmployment;
  readonly organization: FakeOrganization;
  readonly clock: FixedClock;
  readonly dependencies: CompensationDependencies;
  readonly tenantId: string;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

export const harnessFor = (
  options: { readonly permissions?: readonly string[]; readonly now?: Date } = {},
): Harness => {
  const tenantId = uuidV7();
  const clock = new FixedClock(options.now ?? new Date('2026-06-15T09:00:00Z'));
  const employment = new FakeEmployment();
  const organization = new FakeOrganization();
  const dependencies: CompensationDependencies = {
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores: inMemoryCompensationStores(),
    employment,
    organization,
    clock,
  };
  const dispatcher = new Dispatcher(
    permitting(...(options.permissions ?? ALL_COMPENSATION_PERMISSIONS)),
  );
  const module = compensationModule(dependencies);

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    stores: dependencies.stores,
    employment,
    organization,
    clock,
    dependencies,
    tenantId,
    as: (actor, work) => runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
  };
};
