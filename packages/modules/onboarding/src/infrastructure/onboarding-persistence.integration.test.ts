import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Onboarding } from '../domain/onboarding.js';
import { Task } from '../domain/task.js';
import { taskEvent } from '../domain/task-event.js';
import { Plan } from '../domain/plan.js';
import { PlanVersion, taskTemplate } from '../domain/plan-version.js';

import {
  CONNECTION,
  openOnboardingFixture,
  requireDatabaseInCi,
  TENANT_A,
  type OnboardingFixture,
} from './onboarding-database.fixture.js';

/**
 * What the database is responsible for, checked against a real one.
 *
 * The round trips matter — a civil date that comes back a day early is a deadline nobody missed —
 * but the assertions that carry the module are the last two: **the partial unique index that makes
 * the start command idempotent**, and the **foreign keys that make it impossible for Onboarding to
 * invent an employment or a person**. Neither can be demonstrated anywhere but here.
 */
const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Onboarding persistence');

suite('Onboarding persistence', () => {
  let fixture: OnboardingFixture;

  beforeAll(async () => {
    fixture = await openOnboardingFixture('onboarding_fixture');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const ORIGIN = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
  const NOW = new Date('2026-08-10T09:00:00Z');

  const unwrap = <TValue>(result: { ok: boolean; value?: TValue; error?: unknown }): TValue => {
    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value as TValue;
  };

  const anInstance = async (): Promise<string> => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const onboarding = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: seeded.employmentId,
          personId: seeded.personId,
          plannedStartOn: '2026-09-01',
          employmentStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.insert(transaction, onboarding.snapshot()),
    );
    return onboarding.id;
  };

  it('round-trips a plan, its version and a template without losing a field', async () => {
    const plan = unwrap(
      Plan.create(
        {
          tenantId: TENANT_A,
          code: 'field-engineer',
          name: { en: 'Field engineer', ar: 'مهندس ميداني' },
          description: { en: 'For engineers', ar: 'للمهندسين' },
          metadata: { owner: 'people-ops' },
        },
        NOW,
      ),
    );
    const version = unwrap(
      PlanVersion.draft({ tenantId: TENANT_A, planId: plan.id, versionNumber: 1 }, NOW),
    );
    const template = unwrap(
      taskTemplate(
        {
          tenantId: TENANT_A,
          planVersionId: version.id,
          code: 'safety-briefing',
          sequence: 1,
          title: { en: 'Safety briefing', ar: 'إحاطة السلامة' },
          kind: 'acknowledgement',
          ownerKind: 'role',
          ownerRole: 'safety',
          dueAnchor: 'employment_start',
          dueOffsetDays: -2,
        },
        NOW,
      ),
    );

    const read = await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.plans.insert(transaction, plan.snapshot());
      await fixture.stores.planVersions.insert(transaction, version.snapshot());
      await fixture.stores.templates.insert(transaction, template);
      return {
        plan: await fixture.stores.plans.byCode(transaction, 'field-engineer'),
        templates: await fixture.stores.templates.forVersion(transaction, version.id),
      };
    });

    expect(read.plan?.name).toEqual({ en: 'Field engineer', ar: 'مهندس ميداني' });
    expect(read.plan?.metadata).toEqual({ owner: 'people-ops' });
    expect(read.templates[0]?.ownerRole).toBe('safety');
    expect(read.templates[0]?.dueOffsetDays).toBe(-2);
  });

  /**
   * A `date` column read as a `Date` comes back at the process's local midnight, which on a server
   * west of UTC is the previous day. Every date in this module is selected as text for that reason,
   * and this is what would catch a regression.
   */
  it('returns a civil date as the day that was stored', async () => {
    const onboardingId = await anInstance();
    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.byId(transaction, onboardingId),
    );

    expect(read?.plannedStartOn).toBe('2026-09-01');
    expect(read?.employmentStartOn).toBe('2026-09-01');
  });

  /**
   * The idempotency boundary, against the real index.
   *
   * This is the assertion the whole reliability argument rests on: two live onboardings for one
   * employment are refused by the database, not by a check the application makes and could skip.
   */
  it('refuses a second live onboarding for one employment', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const first = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: seeded.employmentId,
          personId: seeded.personId,
          plannedStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );
    const second = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: seeded.employmentId,
          personId: seeded.personId,
          plannedStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.onboardings.insert(transaction, first.snapshot()),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.onboardings.insert(transaction, second.snapshot()),
      ),
    ).rejects.toThrow(/onboarding_instance_live_employment_key/);
  });

  /**
   * A terminal onboarding leaves the index, so a rehire can be onboarded again.
   *
   * The other half of the same decision: an idempotency boundary that never released would make the
   * second employment of a returning employee impossible to onboard, which is a worse bug than the
   * duplicate it prevents.
   */
  it('permits a new onboarding once the previous one has concluded', async () => {
    const seeded = await fixture.seedEmployment(TENANT_A);
    const first = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: seeded.employmentId,
          personId: seeded.personId,
          plannedStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.onboardings.insert(transaction, first.snapshot());
      first.cancel('withdrawn', 'user:test', ORIGIN, NOW);
      await fixture.stores.onboardings.update(transaction, first.snapshot(), 1);
    });

    const second = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: seeded.employmentId,
          personId: seeded.personId,
          plannedStartOn: '2027-01-05',
        },
        ORIGIN,
        NOW,
      ),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.onboardings.insert(transaction, second.snapshot()),
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * Onboarding cannot invent an employment, and the guarantee is structural.
   *
   * Not "the application does not call create" — the port has no `create` — but "the database would
   * refuse the row". Even a defect that fabricated an identifier could not produce an onboarding for
   * a person who does not exist.
   */
  it('refuses an instance pointing at an employment that does not exist', async () => {
    const invented = unwrap(
      Onboarding.start(
        {
          tenantId: TENANT_A,
          employmentId: uuidV7(),
          personId: uuidV7(),
          plannedStartOn: '2026-09-01',
        },
        ORIGIN,
        NOW,
      ),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.onboardings.insert(transaction, invented.snapshot()),
      ),
    ).rejects.toThrow(/onboarding_instance_(employment|person)_fk/);
  });

  /** Progress is counted by the database. These are the numbers a dashboard shows. */
  it('tallies required, optional and overdue tasks in one query', async () => {
    const onboardingId = await anInstance();
    const tasks = [
      { code: 'a', required: true, dueOn: '2026-08-01' },
      { code: 'b', required: true, dueOn: '2026-12-01' },
      { code: 'c', required: false, dueOn: '2026-08-01' },
    ].map((one) =>
      unwrap(
        Task.define(
          {
            tenantId: TENANT_A,
            onboardingId,
            templateCode: one.code,
            sequence: 1,
            title: { en: one.code, ar: one.code },
            kind: 'checklist',
            ownerKind: 'role',
            ownerRole: 'hr',
            required: one.required,
            dueOn: one.dueOn,
          },
          ORIGIN,
          NOW,
        ),
      ),
    );

    const tally = await fixture.asTenant(TENANT_A, async (transaction) => {
      for (const task of tasks) {
        await fixture.stores.tasks.insert(transaction, task.snapshot());
      }
      const [first] = tasks;

      if (first !== undefined) {
        first.complete({ completedBy: 'user:test' }, ORIGIN, NOW);
        await fixture.stores.tasks.update(transaction, first.snapshot(), 1);
      }
      return fixture.stores.tasks.tally(transaction, onboardingId, '2026-08-10');
    });

    expect(tally.requiredTotal).toBe(2);
    expect(tally.requiredSatisfied).toBe(1);
    // The completed one is no longer overdue, and the December one is not yet.
    expect(tally.requiredOverdue).toBe(0);
    expect(tally.optionalTotal).toBe(1);
    expect(tally.byOwnerKindOutstanding).toEqual({ role: 2 });
  });

  /** A plan applied twice cannot double the checklist, and the index is what says so. */
  it('refuses two tasks from one template on one onboarding', async () => {
    const onboardingId = await anInstance();
    const define = (): Task =>
      unwrap(
        Task.define(
          {
            tenantId: TENANT_A,
            onboardingId,
            templateCode: 'sign-contract',
            sequence: 1,
            title: { en: 'Sign', ar: 'وقّع' },
            kind: 'checklist',
            ownerKind: 'role',
            ownerRole: 'hr',
          },
          ORIGIN,
          NOW,
        ),
      );

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.tasks.insert(transaction, define().snapshot()),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.tasks.insert(transaction, define().snapshot()),
      ),
    ).rejects.toThrow(/onboarding_task_template_key/);
  });

  it('appends task history and never offers a way to change it', async () => {
    const onboardingId = await anInstance();
    const task = unwrap(
      Task.define(
        {
          tenantId: TENANT_A,
          onboardingId,
          sequence: 1,
          title: { en: 'Sign', ar: 'وقّع' },
          kind: 'checklist',
          ownerKind: 'role',
          ownerRole: 'hr',
        },
        ORIGIN,
        NOW,
      ),
    );
    const history = await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.tasks.insert(transaction, task.snapshot());
      await fixture.stores.taskEvents.insert(
        transaction,
        taskEvent(
          {
            tenantId: TENANT_A,
            taskId: task.id,
            onboardingId,
            kind: 'created',
            toStatus: task.status,
            occurredAt: NOW,
            recordedBy: 'user:test',
          },
          NOW,
        ),
      );
      return fixture.stores.taskEvents.forTask(transaction, task.id);
    });

    expect(history).toHaveLength(1);
    expect(history[0]?.recordedBy).toBe('user:test');
    // The store offers no `update` and no `remove`. Stated as a compile-time fact rather than a
    // runtime one: a history that could be amended is not history.
    expect('update' in fixture.stores.taskEvents).toBe(false);
  });
});
