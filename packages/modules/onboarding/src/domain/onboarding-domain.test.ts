import { describe, expect, it } from 'vitest';
import { uuidV7, type EventOrigin } from '@work/kernel';

import { Onboarding } from './onboarding.js';
import { Plan } from './plan.js';
import { PlanVersion, taskTemplate } from './plan-version.js';
import { Task } from './task.js';
import { addDays, civilDateOf, isTaskSatisfied } from './onboarding-vocabulary.js';

/**
 * The rules that hold whether or not there is a database, an API or a tenant.
 *
 * They are tested here rather than through the handlers because a rule proved through four layers is
 * a rule whose failure is reported by whichever layer noticed — and the reader then has to work out
 * which one decided. What is asserted below is the domain's own answer.
 */

const TENANT = uuidV7();
const NOW = new Date('2026-08-10T09:00:00Z');
const ORIGIN: EventOrigin = { tenantId: TENANT, correlationId: uuidV7(), actor: 'user:hr' };

const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value as TValue;
};

describe('A plan holds no tasks, and a published version never changes', () => {
  it('refuses a plan named in only one language', () => {
    const refused = Plan.create(
      { tenantId: TENANT, code: 'joiner', name: { en: 'Joiner', ar: '  ' } },
      NOW,
    );

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.reason).toBe('text_requires_both_languages');
  });

  it('refuses to activate a plan with no published version', () => {
    const plan = unwrap(
      Plan.create(
        { tenantId: TENANT, code: 'joiner', name: { en: 'Joiner', ar: 'منضم' } },
        NOW,
      ),
    );

    expect(plan.activate(false, NOW).ok).toBe(false);
    expect(plan.activate(true, NOW).ok).toBe(true);
  });

  /**
   * An empty checklist is worse than no plan at all: it produces onboardings that complete the
   * moment they begin, and a completion record that means nothing looks exactly like one that does.
   */
  it('refuses to publish a version holding no tasks', () => {
    const version = unwrap(
      PlanVersion.draft({ tenantId: TENANT, planId: uuidV7(), versionNumber: 1 }, NOW),
    );

    expect(version.publish(0, 'user:hr', ORIGIN, NOW).ok).toBe(false);
    expect(version.publish(2, 'user:hr', ORIGIN, NOW).ok).toBe(true);
    // Published once, and never again — a second publication would move what a hundred joiners were
    // measured against.
    expect(version.publish(2, 'user:hr', ORIGIN, NOW).ok).toBe(false);
  });

  it('refuses a document template that does not say which document it wants', () => {
    const refused = taskTemplate(
      {
        tenantId: TENANT,
        planVersionId: uuidV7(),
        code: 'passport',
        sequence: 1,
        title: { en: 'Passport', ar: 'جواز السفر' },
        kind: 'document',
        ownerKind: 'employee',
      },
      NOW,
    );

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.reason).toBe('document_task_needs_a_type');
  });

  it('refuses an owner whose kind and reference disagree', () => {
    const roleWithoutRole = taskTemplate(
      {
        tenantId: TENANT,
        planVersionId: uuidV7(),
        code: 'laptop',
        sequence: 1,
        title: { en: 'Laptop', ar: 'حاسوب' },
        kind: 'external',
        ownerKind: 'role',
      },
      NOW,
    );
    const employeeWithReference = taskTemplate(
      {
        tenantId: TENANT,
        planVersionId: uuidV7(),
        code: 'badge',
        sequence: 1,
        title: { en: 'Badge', ar: 'بطاقة' },
        kind: 'checklist',
        ownerKind: 'employee',
        ownerRef: uuidV7(),
      },
      NOW,
    );

    expect(!roleWithoutRole.ok && roleWithoutRole.error.reason).toBe('role_owner_needs_a_role');
    expect(!employeeWithReference.ok && employeeWithReference.error.reason).toBe(
      'resolved_owner_takes_no_reference',
    );
  });
});

describe('An onboarding is a process, and owns no employment fact', () => {
  const anOnboarding = (): Onboarding =>
    unwrap(
      Onboarding.start(
        {
          tenantId: TENANT,
          employmentId: uuidV7(),
          personId: uuidV7(),
          plannedStartOn: '2026-09-01',
          employmentStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );

  it('moves forward, and never back out of a terminal state', () => {
    const onboarding = anOnboarding();

    expect(onboarding.beginPreboarding(ORIGIN, NOW).ok).toBe(true);
    expect(onboarding.beginOnboarding(ORIGIN, NOW).ok).toBe(true);
    expect(onboarding.cancel('withdrawn', 'user:hr', ORIGIN, NOW).ok).toBe(true);
    // Nothing returns from cancelled. A rehire is a new employment and a new onboarding; an edit
    // that quietly reverted this would erase the record that it happened.
    expect(onboarding.beginOnboarding(ORIGIN, NOW).ok).toBe(false);
  });

  /**
   * Completion counts only what was *required*, and a waiver satisfies while a cancellation does
   * not. A task cancelled while the onboarding ran was never dealt with, and calling the onboarding
   * complete would be this product asserting something nobody did.
   */
  it('refuses completion while a required task is outstanding', () => {
    const onboarding = anOnboarding();

    onboarding.beginOnboarding(ORIGIN, NOW);

    expect(
      onboarding.complete({ requiredTotal: 2, requiredSatisfied: 1 }, 'user:hr', ORIGIN, NOW).ok,
    ).toBe(false);
    // Overdue does not block completion: a task done late is still done, and refusing here would
    // leave an onboarding that can never be closed because a deadline passed in March.
    expect(
      onboarding.complete({ requiredTotal: 2, requiredSatisfied: 2 }, 'user:hr', ORIGIN, NOW).ok,
    ).toBe(true);
  });

  it('records a plan once and refuses a second', () => {
    const onboarding = anOnboarding();
    const planId = uuidV7();

    expect(onboarding.recordPlan(planId, uuidV7(), NOW).ok).toBe(true);
    expect(onboarding.recordPlan(uuidV7(), uuidV7(), NOW).ok).toBe(false);
  });
});

describe('A task carries who owns it, when it is due, and how it ended', () => {
  const aTask = (overrides: Record<string, unknown> = {}): Task =>
    unwrap(
      Task.define(
        {
          tenantId: TENANT,
          onboardingId: uuidV7(),
          sequence: 1,
          title: { en: 'Sign the contract', ar: 'توقيع العقد' },
          kind: 'checklist',
          ownerKind: 'employment',
          ownerRef: uuidV7(),
          dueOn: '2026-08-29',
          ...overrides,
        },
        ORIGIN,
        NOW,
      ),
    );

  it('refuses a document completion with no reference', () => {
    const task = aTask({ kind: 'document', documentTypeCode: 'passport' });
    const refused = task.complete({ completedBy: 'user:hr' }, ORIGIN, NOW);

    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.reason).toBe('document_task_needs_a_reference');
    expect(
      task.complete(
        { completedBy: 'user:hr', documentReference: 'doc:2026/passport/9f3' },
        ORIGIN,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it('treats a waiver as satisfying the requirement, and a cancellation as not', () => {
    const waived = aTask();
    const cancelled = aTask();

    expect(waived.waive({ reasonCode: 'not-applicable', waivedBy: 'user:hr' }, ORIGIN, NOW).ok).toBe(
      true,
    );
    expect(cancelled.cancel(ORIGIN, NOW).ok).toBe(true);
    expect(isTaskSatisfied(waived.status)).toBe(true);
    expect(isTaskSatisfied(cancelled.status)).toBe(false);
  });

  it('answers ownership by employment, never by role', () => {
    const employmentId = uuidV7();
    const mine = aTask({ ownerKind: 'employment', ownerRef: employmentId });
    const queue = aTask({ ownerKind: 'role', ownerRef: undefined, ownerRole: 'it' });

    expect(mine.isOwnedBy(employmentId)).toBe(true);
    expect(mine.isOwnedBy(uuidV7())).toBe(false);
    // A queue belongs to whoever holds the role. Answering `true` here is how a self-service
    // permission would close somebody else's task.
    expect(queue.isOwnedBy(employmentId)).toBe(false);
  });

  it('refuses a second conclusion', () => {
    const task = aTask();

    expect(task.complete({ completedBy: 'user:hr' }, ORIGIN, NOW).ok).toBe(true);
    expect(task.waive({ reasonCode: 'not-applicable', waivedBy: 'user:hr' }, ORIGIN, NOW).ok).toBe(
      false,
    );
  });
});

describe('Dates are civil dates, in UTC', () => {
  /**
   * Calendar days, not working days: which week-end a tenant keeps is country data a country pack
   * owns, and Organization publishes no calendar read for this module to ask (00B).
   */
  it('adds days without moving the date across a zone boundary', () => {
    expect(addDays('2026-09-01', -3)).toBe('2026-08-29');
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    // A leap day is a day, not a special case.
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('reads today from an instant in UTC', () => {
    expect(civilDateOf(new Date('2026-08-10T23:30:00Z'))).toBe('2026-08-10');
  });
});
