import { beforeEach, describe, expect, it } from 'vitest';

import type { AssignmentView, CertificationView } from '../contracts/views.js';
import { LearningPermissions } from './learning-permissions.js';
import {
  HR,
  MANAGER,
  OTHER_TENANT,
  TODAY,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  send,
  tryAsk,
  type Harness,
} from './learning-test-harness.js';
import { EMPLOYMENT, aPublishedCourse, withWorkforce } from './learning-scenarios.js';

/**
 * Who may do what, and the four ways a caller might try to get round it.
 *
 * **UI visibility is never authorization.** Every assertion below goes through the dispatcher, which
 * checks the handler's declared permission before the handler runs. A screen that hid a button would
 * change nothing here.
 *
 * **A client-supplied identity is never proof of identity.** The actor comes from the authenticated
 * context, and an employment identifier in a request is a filter rather than a claim about who is
 * asking. The `read-team` cases below are where that matters most.
 */

const only = (...permissions: string[]): { readonly permissions: readonly string[] } => ({
  permissions,
});

describe('the permission matrix', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('lets a holder through and refuses everybody else, naming the permission', async () => {
    const nobody = harnessFor(only(LearningPermissions.catalogueRead));

    withWorkforce(nobody);

    const refused = await nobody.as(HR, () =>
      attempt(nobody, {
        commandName: 'learning.create-course',
        code: 'fire-safety',
        name: { en: 'Fire safety', ar: 'السلامة' },
        delivery: 'virtual',
      }),
    );

    expect(reasonOf(refused)).toBe('forbidden:learning.catalogue.manage');
    await harness.as(HR, () => aPublishedCourse(harness));
  });

  it('does not let managing an assignment become waiving one', async () => {
    const manager = harnessFor(
      only(
        LearningPermissions.catalogueManage,
        LearningPermissions.assignmentManage,
        LearningPermissions.assignmentRead,
        LearningPermissions.assignmentReadAll,
      ),
    );

    withWorkforce(manager);

    const refused = await manager.as(MANAGER, async () => {
      const course = await aPublishedCourse(manager);
      const { assignmentId } = await send<{ assignmentId: string }>(manager, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      return attempt(manager, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: 'Exempt',
      });
    });

    expect(reasonOf(refused)).toBe('forbidden:learning.assignment.waive');
  });

  it('does not let managing an enrolment become recording that somebody finished', async () => {
    const clerk = harnessFor(
      only(LearningPermissions.catalogueManage, LearningPermissions.enrolmentManage),
    );

    withWorkforce(clerk);

    const refused = await clerk.as(MANAGER, async () => {
      const course = await aPublishedCourse(clerk);
      const { enrolmentId } = await send<{ enrolmentId: string }>(clerk, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      await send(clerk, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });
      return attempt(clerk, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });
    });

    expect(reasonOf(refused)).toBe('forbidden:learning.enrolment.complete');
  });

  it('does not let issuing a certification become taking one away', async () => {
    const registrar = harnessFor(only(LearningPermissions.certificationManage));

    withWorkforce(registrar);

    const refused = await registrar.as(HR, async () => {
      const { certificationId } = await send<{ certificationId: string }>(registrar, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
      });

      return attempt(registrar, {
        commandName: 'learning.revoke-certification',
        certificationId,
        expectedVersion: 1,
        reason: 'Withdrawn by the issuer',
      });
    });

    expect(reasonOf(refused)).toBe('forbidden:learning.certification.revoke');
  });

  it('refuses reconciliation to a caller who may only read the requirements', async () => {
    const reader = harnessFor(only(LearningPermissions.mandatoryRead));

    withWorkforce(reader);

    const refused = await reader.as(HR, () =>
      attempt(reader, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId: 'whatever',
      }),
    );

    expect(reasonOf(refused)).toBe('forbidden:learning.reconcile');
  });
});

describe('read scope', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  const anAssignment = async (): Promise<void> => {
    const course = await aPublishedCourse(harness);

    await send(harness, {
      commandName: 'learning.assign',
      employmentId: EMPLOYMENT,
      courseId: course.courseId,
    });
  };

  it('gives a `read-all` holder the records, as HR reading the organization', async () => {
    await harness.as(HR, async () => {
      await anAssignment();

      const found = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
      });

      expect(found.items).toHaveLength(1);
    });
  });

  it('gives a `read-team` holder nothing, whatever employment they name', async () => {
    await harness.as(HR, anAssignment);

    const team = harnessFor(
      only(LearningPermissions.assignmentRead, LearningPermissions.assignmentReadTeam),
    );

    withWorkforce(team);

    const found = await team.as(MANAGER, () =>
      ask<{ readonly items: readonly AssignmentView[] }>(team, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYMENT,
      }),
    );

    // There is no way to know which employment the caller *is* (ADR-0032), so honouring a
    // caller-supplied identifier would be an IDOR wearing a permission's name. NOT VERIFIED.
    expect(found.items).toHaveLength(0);
  });

  it('does not let a narrow read become a wide one through a different query', async () => {
    await harness.as(HR, anAssignment);

    const narrow = harnessFor(
      only(
        LearningPermissions.assignmentRead,
        LearningPermissions.enrolmentRead,
        LearningPermissions.certificationRead,
      ),
    );

    withWorkforce(narrow);

    await narrow.as(MANAGER, async () => {
      const assignments = await ask<{ readonly items: readonly AssignmentView[] }>(narrow, {
        queryName: 'learning.search-assignments',
      });
      const certifications = await ask<{ readonly items: readonly CertificationView[] }>(narrow, {
        queryName: 'learning.search-certifications',
      });
      const history = await tryAsk(narrow, {
        queryName: 'learning.read-history',
        employmentId: EMPLOYMENT,
      });

      expect(assignments.items).toHaveLength(0);
      expect(certifications.items).toHaveLength(0);
      // Not "forbidden": that would confirm this employment has a training record.
      expect(reasonOf(history)).toBe('not_found:learning_history');
    });
  });

  it('takes the actor from the context, never from the command', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const { assignmentId } = await send<{ assignmentId: string }>(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
        // A caller trying to file the waiver under somebody else's name.
        assignedBy: 'user:somebody-else',
        waivedBy: 'user:somebody-else',
      });

      await send(harness, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: 'Holds an equivalent licence',
        waivedBy: 'user:somebody-else',
      });

      const held = harness.stores.tables.assignments.get(assignmentId);

      expect(held?.assignedBy).toBe(HR);
      expect(held?.waivedBy).toBe(HR);
    });
  });
});

describe('tenant isolation at the application boundary', () => {
  it('shows one tenant nothing of another’s records', async () => {
    const harness = harnessFor();

    withWorkforce(harness);

    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await send(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });
    });

    // The in-memory unit of work is scoped to one tenant, so a read in another tenant's context
    // reaches a different store entirely. The database enforces the same thing with row-level
    // security, which the schema suite checks in both directions.
    const other = harnessFor({ tenantId: OTHER_TENANT });

    withWorkforce(other);

    const found = await other.inTenant(OTHER_TENANT, HR, () =>
      ask<{ readonly items: readonly AssignmentView[] }>(other, {
        queryName: 'learning.search-assignments',
      }),
    );

    expect(found.items).toHaveLength(0);
  });

  it('refuses any operation outside a tenant context rather than guessing one', async () => {
    const harness = harnessFor();

    await expect(
      harness.dispatcher.send({ commandName: 'learning.create-course' } as never),
    ).rejects.toThrow(/tenant/i);
  });
});
