import { beforeEach, describe, expect, it } from 'vitest';

import { LearningPermissions, UNROUTED_LEARNING_PERMISSIONS } from './learning-permissions.js';
import { learningModule } from './learning-module.js';
import { HR, attempt, harnessFor, reasonOf, send, type Harness } from './learning-test-harness.js';
import {
  EMPLOYMENT,
  OTHER_EMPLOYMENT,
  UNIT,
  aMandatoryRule,
  aPublishedCourse,
  withWorkforce,
} from './learning-scenarios.js';

/**
 * What this module does when something it depends on cannot answer.
 *
 * **A dependency that failed is never a zero, a false, or a success.** The dangerous version of every
 * case below is the quiet one: a reconciliation that reports full compliance for an organization it
 * never looked at, a certification recorded against an employment nobody confirmed, or a screen
 * implying a certificate is on file because a document reference was accepted without checking.
 *
 * **And nothing here claims a capability the repository does not have.** No notification is
 * delivered, no file is fetched, and nothing is scheduled — the assertions say so explicitly rather
 * than leaving it to be inferred from an absence.
 */

describe('when a dependency cannot answer', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('refuses to reconcile rather than reporting that nobody needs training', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      harness.employment.becomeUnavailable();

      const run = await attempt(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId: ruleId,
      });

      // The failure mode this refuses: `{ generated: 0, alreadyPresent: 0 }` reads as "everybody is
      // up to date" on a compliance screen.
      expect(reasonOf(run)).toBe('learning.rejection.employment-unavailable');
      expect(harness.stores.tables.assignments.size).toBe(0);
    });
  });

  it('refuses to assign to an employment it could not confirm', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      const refused = await attempt(harness, {
        commandName: 'learning.assign',
        employmentId: 'employment-nobody',
        courseId: course.courseId,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.assignment-employment-unknown');
    });
  });

  it('refuses to enrol somebody whose employment has ended', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      harness.employment.end(OTHER_EMPLOYMENT);

      const refused = await attempt(harness, {
        commandName: 'learning.enrol',
        employmentId: OTHER_EMPLOYMENT,
        courseId: course.courseId,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.enrolment-employment-inactive');
    });
  });

  it('refuses a requirement for an organization unit Organization could not confirm', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      const refused = await attempt(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId: course.courseId,
        name: { en: 'Unit training', ar: 'تدريب الوحدة' },
        kind: 'compliance',
        audience: 'organization_unit',
        organizationUnitId: 'unit-nobody',
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.rule-organization-unit-unknown');
      // The confirmed one still works, so this is a real check rather than a blanket refusal.
      await aMandatoryRule(harness, course.courseId, {
        audience: 'organization_unit',
        organizationUnitId: UNIT,
      });
    });
  });

  it('refuses to register an instructor against an employment it could not confirm', async () => {
    await harness.as(HR, async () => {
      const refused = await attempt(harness, {
        commandName: 'learning.register-instructor',
        employmentId: 'employment-nobody',
      });

      expect(reasonOf(refused)).toBe('learning.rejection.instructor-employment-unknown');
    });
  });
});

describe('what this module does not claim', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('records a notification intent and never claims anybody was told', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await send(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      const [recorded] = harness.notifications.recorded;

      // An intent is a real record; delivery is a missing dependency, and no field here says
      // "sent", "delivered" or "at".
      expect(recorded?.templateKey).toBe('learning.assignment.created');
      expect(Object.keys(recorded ?? {})).toEqual(['templateKey', 'recipients']);
    });
  });

  it('creates no Person for an external instructor', async () => {
    await harness.as(HR, async () => {
      await send(harness, {
        commandName: 'learning.register-instructor',
        externalName: { en: 'Visiting trainer', ar: 'مدرّب زائر' },
        externalOrganization: 'Gulf Safety Institute',
      });

      const [held] = [...harness.stores.tables.instructors.values()];

      expect(held?.employmentId).toBeUndefined();
      expect(held?.externalOrganization).toBe('Gulf Safety Institute');
    });
  });

  it('registers no command that mutates a status directly', () => {
    const commands = (learningModule(moduleDependencies(harness)).commands ?? []).map(
      (handler) => handler.commandName,
    );

    // Every lifecycle move is a named act. There is no `set-status`, no `update-enrolment` and no
    // generic patch through which a caller could name a state.
    expect(commands.filter((name) => /set-|patch|update-status/.test(name))).toEqual([]);
    expect(commands).toContain('learning.complete-enrolment');
    expect(commands).toContain('learning.withdraw-enrolment');
  });

  it('declares the two self-service permissions and routes neither of them', () => {
    const module = learningModule(moduleDependencies(harness));
    const routed = [
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ];

    for (const permission of UNROUTED_LEARNING_PERMISSIONS) {
      expect([permission, routed.includes(permission)]).toEqual([permission, false]);
    }
    // They are still offered, because the contract is real even though the platform cannot yet
    // grant it (ADR-0032). Self-service routing is NOT VERIFIED.
    expect(module.permissions).toContain(LearningPermissions.assignmentReadOwn);
  });

  it('schedules nothing: the reconciliation command is the only way a requirement appears', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await aMandatoryRule(harness, course.courseId);

      // Time passes. Nothing runs, because nothing in this repository can run anything.
      harness.clock.advanceTo(new Date('2030-01-01T09:00:00Z'));
      expect(harness.stores.tables.assignments.size).toBe(0);
    });
  });
});

/** The dependency bundle the module declaration needs, taken from an already-built harness. */
const moduleDependencies = (harness: Harness): Parameters<typeof learningModule>[0] => ({
  unitOfWork: { execute: (work) => work({} as never) },
  stores: harness.stores,
  employment: harness.employment,
  organization: harness.organization,
  documents: harness.documents,
  notifications: harness.notifications,
  permissions: { holds: () => Promise.resolve(true) },
  clock: harness.clock,
});
