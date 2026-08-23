import { uuidV7, type Transaction } from '@work/kernel';

import type { InvestigationRecord } from '../domain/investigation.js';
import { TENANT_A, type RelationsFixture } from './relations-database.fixture.js';

/**
 * Seeding for the case-lifecycle integration suites.
 *
 * Two suites need the same three things — a violation to hang a case on, an inquiry into it, and a
 * transition in its history — and each suite grew past the 400-line budget with them inlined. They
 * are here rather than duplicated so that a change to the schema updates one seed, not two.
 *
 * Everything writes through the **real repositories**, so a seed that the mapper or a constraint
 * would reject fails in the seed rather than producing a row the production path could not have
 * written.
 */

export const CATEGORY = {
  code: 'unauthorized-absence',
  name: { en: 'Unauthorized absence', ar: 'غياب غير مصرح به' },
  severity: 'major',
  sequence: 10,
  repeatWindowDays: 180,
  source: 'tenant' as const,
  active: true,
  version: 1,
};

export const givenViolation = async (
  fixture: RelationsFixture,
  tenantId: string = TENANT_A,
): Promise<string> => {
  const categoryId = uuidV7();
  const violationId = uuidV7();

  await fixture.asTenant(tenantId, async (transaction) => {
    await fixture.stores.categories.insert(transaction, {
      ...CATEGORY,
      violationCategoryId: categoryId,
    });
    await fixture.stores.violations.insert(transaction, {
      violationId,
      employmentId: uuidV7(),
      violationCategoryId: categoryId,
      categoryCode: CATEGORY.code,
      severity: CATEGORY.severity,
      occurredOn: '2026-08-14',
      reportedBy: 'user:officer',
      description: 'Absent without notice.',
      state: 'reported',
      recordedAt: new Date('2026-08-22T09:00:00Z'),
      version: 1,
    });
  });
  return violationId;
};

export const openInquiry = async (
  fixture: RelationsFixture,
  violationId: string,
  tenantId: string = TENANT_A,
  overrides: Partial<InvestigationRecord> = {},
): Promise<string> => {
  const investigationId = overrides.investigationId ?? uuidV7();

  await fixture.asTenant(tenantId, (transaction) =>
    fixture.stores.investigations.insert(transaction, {
      investigationId,
      violationId,
      investigatorMembershipId: uuidV7(),
      openedOn: '2026-08-21',
      subject: 'Three consecutive unnotified absences',
      state: 'open',
      version: 1,
      ...overrides,
    }),
  );
  return investigationId;
};

export const appendTransition = (
  fixture: RelationsFixture,
  transaction: Transaction,
  violationId: string,
  sequence: number,
  states: readonly [string, string] = ['reported', 'under_investigation'],
): Promise<unknown> =>
  fixture.stores.caseEvents.insert(transaction, {
    caseEventId: uuidV7(),
    violationId,
    sequence,
    fromState: states[0] as 'reported',
    toState: states[1] as 'under_investigation',
    reason: 'The supervisor asked for the absences to be looked into.',
    actor: 'user:officer',
    occurredAt: new Date('2026-08-22T09:00:00Z'),
    correlationId: uuidV7(),
  });
