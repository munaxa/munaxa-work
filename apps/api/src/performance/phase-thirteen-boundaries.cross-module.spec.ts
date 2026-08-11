import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  DOCUMENT_ID,
  EMPLOYEE_ID,
  MANAGER_ID,
  OUTSIDER_ID,
  PEER_ID,
  ask,
  attempt,
  harnessFor,
  requireDatabaseInCi,
  send,
  tryAsk,
  type CrossModuleHarness,
} from './phase-thirteen-harness.js';
import { anOpenCycle, configure } from './phase-thirteen-configuration.js';

/**
 * Phase 13 across every production boundary: the real dispatcher, the real Performance handlers,
 * **real PostgreSQL repositories**, and the real Employment, Organization and Documents adapters
 * under real bounded service grants.
 *
 * The mandatory scenario runs end to end — configure, enrol, set goals, assess, score, calibrate,
 * complete, then change the configuration and read the completed review back unchanged. Nothing in
 * it is stubbed on the Performance side, and the three upstream modules answer through their
 * published contracts on the same dispatcher.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 13 cross-module suite');

/**
 * The boundaries Phase 13 crosses, one at a time: Employment's direct-report contract, the refusal
 * of an employment it no longer calls active, Documents' reference read, the authorization
 * regressions, and reconciliation working with no event ever delivered.
 */

suite('phase thirteen boundaries', () => {
  let harness: CrossModuleHarness;

  beforeAll(() => {
    harness = harnessFor();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  it('reads a manager’s direct reports through the existing Employment contract', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID, PEER_ID, OUTSIDER_ID],
    });

    // `employment.search` with `managerEmploymentId`, resolved against the reporting line as of a
    // date. **No new Employment contract was added**, and the adapter narrows the published view.
    const team = await ask<{ readonly items: readonly { readonly employmentId: string }[] }>(
      harness,
      { queryName: 'performance.reviews', cycleId: cycle, managerEmploymentId: MANAGER_ID },
    );

    expect(team.items.map((review) => review.employmentId).sort()).toEqual(
      [EMPLOYEE_ID, PEER_ID].sort(),
    );

    // A manager with no reports reads nothing rather than everything.
    const none = await ask<{ readonly items: readonly unknown[] }>(harness, {
      queryName: 'performance.reviews',
      cycleId: cycle,
      managerEmploymentId: OUTSIDER_ID,
    });

    expect(none.items).toEqual([]);
  });

  it('refuses to enrol an employment Employment no longer calls active, and names it', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    harness.facts.employments = harness.facts.employments.map((employment) =>
      employment.employmentId === PEER_ID ? { ...employment, status: 'ended' } : employment,
    );

    const enrolled = await send<{
      readonly enrolled: number;
      readonly refused: readonly string[];
    }>(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID, PEER_ID],
    });

    expect(enrolled.enrolled).toBe(1);
    // Named, not silently dropped. A cycle that quietly enrolled some of a team is a cycle where
    // somebody never got a review and nobody found out until they asked.
    expect(enrolled.refused).toEqual([PEER_ID]);
  });

  it('refuses a goal citing a document nobody can find', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    harness.facts.documentPresent = false;

    const refused = await attempt(harness, {
      commandName: 'performance.create-goal',
      scope: 'individual',
      employmentId: EMPLOYEE_ID,
      cycleId: cycle,
      title: 'A goal citing a phantom',
      measurement: 'numeric',
      weightBasisPoints: 10_000,
      startDate: new Date('2026-01-01'),
      dueDate: new Date('2026-12-31'),
      evidenceDocumentId: DOCUMENT_ID,
    });

    expect(refused.ok).toBe(false);
    harness.facts.documentPresent = true;
  });

  it('does not let a review’s own manager grant a read-team caller access to it', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID],
    });

    const queue = await ask<{ readonly items: readonly { readonly reviewId: string }[] }>(harness, {
      queryName: 'performance.reviews',
      cycleId: cycle,
    });
    const reviewId = queue.items[0]?.reviewId ?? '';

    // A caller naming a manager who does not manage this employment reads nothing — the scope comes
    // from the caller, never from the target record. This is the regression the application
    // checkpoint found: the review always has a manager, and that manager always has it among their
    // reports, so deriving scope from the review was a free pass wearing the shape of a check.
    const foreign = await tryAsk(harness, {
      queryName: 'performance.read-review',
      reviewId,
      managerEmploymentId: OUTSIDER_ID,
    });

    expect(foreign.ok).toBe(false);

    // The actual manager reads it. 404 above rather than 403, because confirming a review exists is
    // itself the disclosure.
    const permitted = await tryAsk(harness, {
      queryName: 'performance.read-review',
      reviewId,
      managerEmploymentId: MANAGER_ID,
    });

    expect(permitted.ok).toBe(true);
  });

  it('admits an invited reviewer and refuses an uninvited one, on the real path', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID],
    });

    const queue = await ask<{ readonly items: readonly { readonly reviewId: string }[] }>(harness, {
      queryName: 'performance.reviews',
      cycleId: cycle,
    });
    const reviewId = queue.items[0]?.reviewId ?? '';

    const uninvited = await attempt(harness, {
      commandName: 'performance.start-assessment',
      reviewId,
      assessmentKind: 'peer',
      assessorEmploymentId: OUTSIDER_ID,
    });

    expect(uninvited.ok).toBe(false);

    await send(harness, {
      commandName: 'performance.assign-reviewer',
      reviewId,
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });

    const invited = await attempt(harness, {
      commandName: 'performance.start-assessment',
      reviewId,
      assessmentKind: 'peer',
      assessorEmploymentId: PEER_ID,
    });

    // The regression the application checkpoint found: success and refusal both returned strings,
    // so every invited reviewer was refused. Proved here on the production path.
    expect(invited.ok).toBe(true);

    const wrongReview = await attempt(harness, {
      commandName: 'performance.start-assessment',
      reviewId: '01930000-0000-7000-8000-00000000dead',
      assessmentKind: 'peer',
      assessorEmploymentId: PEER_ID,
    });

    expect(wrongReview.ok).toBe(false);
  });

  it('records a notification intent and delivers nothing', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID],
    });

    const queue = await ask<{ readonly items: readonly { readonly reviewId: string }[] }>(harness, {
      queryName: 'performance.reviews',
      cycleId: cycle,
    });

    await send(harness, {
      commandName: 'performance.assign-reviewer',
      reviewId: queue.items[0]?.reviewId ?? '',
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });

    // The kernel's recorder holds the intent. Nothing delivered it, because nothing delivers
    // anything in this repository — and no screen built later may imply otherwise (D-21).
    expect(harness.notifications.sent.map((request) => request.templateKey)).toContain(
      'performance.reviewer.invited',
    );
  });

  it('finds what reconciliation finds without any event having been delivered', async () => {
    const configured = await configure(harness);
    const cycle = await anOpenCycle(harness, configured.templateId);

    await send(harness, {
      commandName: 'performance.enrol-participants',
      cycleId: cycle,
      employmentIds: [EMPLOYEE_ID],
    });

    // No goals were created, and the template requires them to total 10,000. **Nothing published an
    // event and nothing subscribed to one**: correctness here is a query somebody runs, so a lost
    // event costs nothing because there is none to lose (ADR-0064).
    const findings = await ask<{ readonly items: readonly { readonly kind: string }[] }>(harness, {
      queryName: 'performance.reconciliation',
      cycleId: cycle,
    });

    expect(findings.items.map((finding) => finding.kind)).toContain('review-has-no-goals');

    // Running it again finds the same thing. It reports; it repairs nothing.
    const again = await ask<{ readonly items: readonly { readonly kind: string }[] }>(harness, {
      queryName: 'performance.reconciliation',
      cycleId: cycle,
    });

    expect(again.items).toEqual(findings.items);
  });
});
