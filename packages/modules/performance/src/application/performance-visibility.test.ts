import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';
import {
  HR,
  MANAGER,
  attempt,
  harnessFor,
  reasonOf,
  send,
  tryAsk,
  type Harness,
} from './performance-test-harness.js';
import {
  DIRECTOR_EMPLOYMENT,
  EMPLOYEE_EMPLOYMENT,
  MANAGER_EMPLOYMENT,
  PEER_EMPLOYMENT,
  configure,
  createGoals,
  openCycleWith,
  registerWorkforce,
  submitManagerAssessment,
  type Configured,
} from './performance-scenarios.js';
import { PerformancePermissions } from './performance-permissions.js';

/**
 * Every refusal the checkpoint requires, and the permitted case beside it.
 *
 * A rule that is only ever tested by its refusal is a rule that might be refusing everything. So
 * each block below asserts the thing that *is* allowed as well as the thing that is not — the
 * lesson Phase 12 learned when two triggers turned out to refuse more than they should.
 */

/**
 * The refusals that guard a rating once it exists: who may calibrate it, who may approve anything,
 * who may read it, and what reconciliation does with what it finds.
 *
 * `system:auto-approval` decides nothing here, as it decides nothing in the five modules before
 * this one — and the actor comes from the authenticated context, so the only way to test the rule
 * is to act as it and watch the aggregate refuse.
 */

/**
 * Who may read what, and the two boundaries the plan says the database cannot draw.
 *
 * Tenant isolation belongs to row-level security and is proved against a real database in the next
 * checkpoint; what these prove is the finer rule RLS cannot express at all — **employee A must not
 * read employee B's review** — and that it holds at the application layer, before any row leaves
 * the store.
 */

describe('who may read a performance record', () => {
  let harness: Harness;
  let configured: Configured;

  beforeEach(async () => {
    harness = harnessFor();
    registerWorkforce(harness);
    configured = await configure(harness, HR);
  });

  const scoredReview = async (): Promise<{
    readonly cycleId: string;
    readonly reviewId: string;
  }> => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 400 },
      { competencyId: configured.competencyIds[0], score: 400 },
      { competencyId: configured.competencyIds[1], score: 400 },
    ]);
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );

    return enrolled;
  };

  it('gives one tenant no reach into another tenant’s reviews', async () => {
    const enrolled = await scoredReview();
    const otherTenant = uuidV7();
    const elsewhere = harnessFor({ tenantId: otherTenant });

    registerWorkforce(elsewhere);

    const found = await elsewhere.as(HR, () =>
      tryAsk(elsewhere, { queryName: 'performance.read-review', reviewId: enrolled.reviewId }),
    );

    expect(found.ok).toBe(false);
    expect(reasonOf(found)).toBe('not_found:performance_review');

    // **This is not the isolation guarantee, and it must not be read as one.** `InMemoryUnitOfWork`
    // ignores the ambient tenant entirely, so what this proves is only that two tenants' work does
    // not leak through shared module state. Real cross-tenant isolation is row-level security's,
    // and it is proved against a real database as an unprivileged role in the next checkpoint —
    // `NOT VERIFIED` here, and stated as such in the report rather than implied by a green test.
    const ownTenant = await harness.as(HR, () =>
      tryAsk(harness, { queryName: 'performance.read-review', reviewId: enrolled.reviewId }),
    );

    expect(ownTenant.ok).toBe(true);
  });

  it('gives a read-team caller nothing until they say whose team, and never somebody else’s review', async () => {
    const enrolled = await scoredReview();
    const teamOnly = harnessFor({
      permissions: [PerformancePermissions.reviewReadTeam, PerformancePermissions.cycleRead],
    });

    registerWorkforce(teamOnly);

    const blind = await teamOnly.as(MANAGER, () =>
      tryAsk(teamOnly, { queryName: 'performance.reviews' }),
    );

    expect(blind.ok).toBe(true);
    if (blind.ok) expect((blind.value as { readonly items: readonly unknown[] }).items).toEqual([]);

    // And on the harness that does hold the data: a `read-team` caller naming a manager who does
    // not manage this employment reads nothing about it.
    const foreign = await harness.as(MANAGER, () =>
      tryAsk(harness, {
        queryName: 'performance.read-review',
        reviewId: enrolled.reviewId,
        managerEmploymentId: DIRECTOR_EMPLOYMENT,
      }),
    );

    expect(foreign.ok).toBe(false);
    expect(reasonOf(foreign)).toBe('not_found:performance_review');

    // Naming the manager who does manage them reads it. 404 rather than 403 above, because
    // confirming a review exists is itself the disclosure.
    const permitted = await harness.as(MANAGER, () =>
      tryAsk(harness, {
        queryName: 'performance.read-review',
        reviewId: enrolled.reviewId,
        managerEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );

    expect(permitted.ok).toBe(true);
  });

  it('refuses feedback about oneself and withdrawal by anybody but its author', async () => {
    const about = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.give-feedback',
        subjectEmploymentId: EMPLOYEE_EMPLOYMENT,
        authorEmploymentId: EMPLOYEE_EMPLOYMENT,
        kind: 'praise',
        visibility: 'manager',
        body: 'I did well.',
      }),
    );

    expect(about.ok).toBe(false);
    expect(reasonOf(about)).toContain('feedback-about-self');

    const given = await harness.as(MANAGER, () =>
      send<{ readonly feedbackId: string }>(harness, {
        commandName: 'performance.give-feedback',
        subjectEmploymentId: EMPLOYEE_EMPLOYMENT,
        authorEmploymentId: MANAGER_EMPLOYMENT,
        kind: 'praise',
        visibility: 'manager',
        body: 'Carried the migration through a difficult week.',
      }),
    );
    const stranger = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.withdraw-feedback',
        feedbackId: given.feedbackId,
        authorEmploymentId: PEER_EMPLOYMENT,
      }),
    );

    expect(stranger.ok).toBe(false);
    expect(reasonOf(stranger)).toBe('not_found:performance_feedback');

    const author = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.withdraw-feedback',
        feedbackId: given.feedbackId,
        authorEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );

    expect(author.ok).toBe(true);
  });

  it('refuses to close a cycle whose reviews are unfinished, and closes one that is', async () => {
    const enrolled = await scoredReview();

    const early = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.close-cycle',
        cycleId: enrolled.cycleId,
        expectedVersion: 2,
      }),
    );

    expect(early.ok).toBe(false);
    expect(reasonOf(early)).toContain('cycle-has-incomplete-reviews');

    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 2,
        status: 'manager_assessment',
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 3,
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.move-cycle',
        cycleId: enrolled.cycleId,
        expectedVersion: 2,
        status: 'in_progress',
      }),
    );

    const closed = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.close-cycle',
        cycleId: enrolled.cycleId,
        expectedVersion: 3,
      }),
    );

    expect(closed.ok).toBe(true);
  });

  it('reports what reconciliation found and repairs none of it', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);

    // A participant with no goals at all: the template requires them to total 10,000.
    const findings = await harness.as(HR, () =>
      harness.dispatcher.ask<{
        readonly items: readonly { readonly kind: string }[];
      }>({ queryName: 'performance.reconciliation', cycleId: enrolled.cycleId } as never),
    );

    expect(findings.ok).toBe(true);
    if (!findings.ok) return;

    expect(findings.value.items.map((finding) => finding.kind)).toContain('review-has-no-goals');

    // Running it again finds the same thing. Nothing was corrected, because nothing corrects.
    const again = await harness.as(HR, () =>
      harness.dispatcher.ask<{
        readonly items: readonly { readonly kind: string }[];
      }>({ queryName: 'performance.reconciliation', cycleId: enrolled.cycleId } as never),
    );

    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.items).toEqual(findings.value.items);
  });
});
