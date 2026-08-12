import { describe, expect, it } from 'vitest';

import {
  defineAssessment,
  hasPassedRequiredAssessments,
  recordResult,
  type AssessmentResultState,
} from './assessment.js';
import { addStep, archivePath, createPath, progressOf, publishPath } from './path.js';
import { deactivateInstructor, isInternal, registerInstructor } from './instructor.js';
import { ASSESSMENT_OUTCOMES } from './learning-vocabulary.js';

/**
 * Assessments, paths and instructors — and three places this module refused to invent something.
 *
 * **No scoring formula.** The specification names five assessment kinds and defines no threshold, no
 * weighting and no rounding, so an assessor records an outcome and nothing here computes one.
 * Aggregate scoring is `NOT VERIFIED`, not approximated.
 *
 * **No competency claim from a path.** Finishing a leadership path says somebody attended those
 * courses (AD-002).
 *
 * **No fake person for an external trainer** (D-6). A visiting trainer is not an employee and gets no
 * `person` row that would put them into headcount.
 */

const NAME = { en: 'Practical check', ar: 'الفحص العملي' };
const AT = new Date('2026-03-01T09:00:00.000Z');

const result = (over: Partial<Parameters<typeof recordResult>[0]> = {}): AssessmentResultState => {
  const recorded = recordResult({
    resultId: 'result-1',
    assessmentId: 'assessment-1',
    enrolmentId: 'enrolment-1',
    employmentId: 'employment-1',
    outcome: 'passed',
    assessedOn: '2026-03-01',
    assessedBy: 'user-assessor',
    recordedAt: AT,
    ...over,
  });

  if (!recorded.ok) throw new Error(recorded.error.reason);
  return recorded.value;
};

const base = {
  resultId: 'result-2',
  assessmentId: 'assessment-1',
  enrolmentId: 'enrolment-1',
  employmentId: 'employment-1',
  outcome: 'passed',
  assessedOn: '2026-03-01',
  assessedBy: 'user-assessor',
  recordedAt: AT,
} as const;

describe('assessments, without a formula nobody specified', () => {
  it('offers exactly three outcomes and no grade, score or percentage among them', () => {
    expect([...ASSESSMENT_OUTCOMES]).toEqual(['passed', 'failed', 'recorded']);
  });

  it('lets an observation be recorded without forcing it into a pass or a fail', () => {
    expect(result({ outcome: 'recorded' }).outcome).toBe('recorded');
  });

  it('keeps a raw mark verbatim as an exact string, never as a float', () => {
    const state = result({ rawMark: '17.5', rawMarkScale: 'out of 20' });

    expect(state.rawMark).toBe('17.5');
    expect(typeof state.rawMark).toBe('string');
  });

  it('refuses a mark with nothing to measure it against, and refuses a mark that is not one', () => {
    expect(recordResult({ ...base, rawMark: '17.5' }).ok).toBe(false);
    expect(recordResult({ ...base, rawMark: 'excellent', rawMarkScale: 'out of 20' }).ok).toBe(
      false,
    );
  });

  it('refuses a result recorded by the auto-approver, and one dated in no calendar', () => {
    expect(recordResult({ ...base, assessedBy: 'system:auto-approval' }).ok).toBe(false);
    expect(recordResult({ ...base, assessedOn: '2026-3-1' }).ok).toBe(false);
  });

  it('refuses to define an assessment without a title in both languages', () => {
    expect(
      defineAssessment({
        assessmentId: 'assessment-1',
        courseVersionId: 'version-1',
        title: { en: 'Quiz', ar: '' },
        kind: 'quiz',
        required: true,
      }).ok,
    ).toBe(false);
  });

  it('answers "did they pass" by presence of outcomes, adding nothing up', () => {
    const required = [{ assessmentId: 'assessment-1' }, { assessmentId: 'assessment-2' }];
    const partial = [
      { assessmentId: 'assessment-1', outcome: 'passed' as const, assessedOn: '2026-03-01' },
    ];

    expect(hasPassedRequiredAssessments(required, partial)).toBe(false);
    expect(
      hasPassedRequiredAssessments(required, [
        ...partial,
        { assessmentId: 'assessment-2', outcome: 'passed', assessedOn: '2026-03-02' },
      ]),
    ).toBe(true);
  });

  it('lets the most recent result win rather than the best or the first', () => {
    const required = [{ assessmentId: 'assessment-1' }];

    expect(
      hasPassedRequiredAssessments(required, [
        { assessmentId: 'assessment-1', outcome: 'failed', assessedOn: '2026-03-01' },
        { assessmentId: 'assessment-1', outcome: 'passed', assessedOn: '2026-03-08' },
      ]),
    ).toBe(true);
    expect(
      hasPassedRequiredAssessments(required, [
        { assessmentId: 'assessment-1', outcome: 'passed', assessedOn: '2026-03-01' },
        { assessmentId: 'assessment-1', outcome: 'failed', assessedOn: '2026-03-08' },
      ]),
    ).toBe(false);
  });

  it('treats a `recorded` outcome as not passing, because nobody said it was', () => {
    expect(
      hasPassedRequiredAssessments(
        [{ assessmentId: 'assessment-1' }],
        [{ assessmentId: 'assessment-1', outcome: 'recorded', assessedOn: '2026-03-01' }],
      ),
    ).toBe(false);
  });
});

describe('a learning path', () => {
  const path = () => {
    const created = createPath({
      pathId: 'path-1',
      code: 'induction',
      name: { en: 'Induction', ar: 'التعريف' },
      kind: 'role_based',
    });

    if (!created.ok) throw new Error(created.error.reason);
    return created.value;
  };

  it('refuses to publish with nothing in it, which anybody could satisfy by doing nothing', () => {
    expect(publishPath(path(), 0).ok).toBe(false);
    expect(publishPath(path(), 3).ok).toBe(true);
  });

  it('refuses a sequence that is not a sensible position', () => {
    const step = { stepId: 'step-1', pathId: 'path-1', courseId: 'course-1', optional: false };

    expect(addStep({ ...step, sequence: 0 }).ok).toBe(false);
    expect(addStep({ ...step, sequence: 1.5 }).ok).toBe(false);
    expect(addStep({ ...step, sequence: 1 }).ok).toBe(true);
  });

  it('archives rather than deletes, and refuses to archive twice', () => {
    const archived = archivePath(path(), AT, 'user-admin');

    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archivePath(archived.value, AT, 'user-admin').ok).toBe(false);
    expect(publishPath(archived.value, 3).ok).toBe(false);
  });

  it('counts progress on read, keeping optional steps apart from required ones', () => {
    const steps = [
      { courseId: 'course-1', optional: false },
      { courseId: 'course-2', optional: false },
      { courseId: 'course-3', optional: true },
    ];
    const progress = progressOf(steps, new Set(['course-1', 'course-3']));

    expect(progress).toEqual({
      requiredTotal: 2,
      requiredCompleted: 1,
      optionalTotal: 1,
      optionalCompleted: 1,
      complete: false,
    });
    expect(progressOf(steps, new Set(['course-1', 'course-2'])).complete).toBe(true);
  });

  it('does not call an empty path complete', () => {
    expect(progressOf([], new Set()).complete).toBe(false);
  });
});

describe('an instructor', () => {
  it('is either one of the tenant’s own people or somebody from outside — never both', () => {
    const internal = registerInstructor({ instructorId: 'i-1', employmentId: 'employment-1' });
    const external = registerInstructor({ instructorId: 'i-2', externalName: NAME });
    const both = registerInstructor({
      instructorId: 'i-3',
      employmentId: 'employment-1',
      externalName: NAME,
    });

    expect(internal.ok).toBe(true);
    expect(external.ok).toBe(true);
    expect(both.ok).toBe(false);
    expect(registerInstructor({ instructorId: 'i-4' }).ok).toBe(false);
  });

  it('copies no personal detail from Employment for an internal instructor', () => {
    const internal = registerInstructor({ instructorId: 'i-1', employmentId: 'employment-1' });

    if (!internal.ok) throw new Error(internal.error.reason);
    expect(isInternal(internal.value)).toBe(true);
    expect(internal.value.externalName).toBeUndefined();
    expect(
      registerInstructor({
        instructorId: 'i-5',
        employmentId: 'employment-1',
        externalContact: 'trainer@example.test',
      }).ok,
    ).toBe(false);
  });

  it('holds an external trainer’s name here rather than manufacturing a person for them', () => {
    const external = registerInstructor({
      instructorId: 'i-2',
      externalName: NAME,
      externalOrganization: 'Gulf Safety Institute',
    });

    if (!external.ok) throw new Error(external.error.reason);
    expect(isInternal(external.value)).toBe(false);
    expect(external.value.externalOrganization).toBe('Gulf Safety Institute');
  });

  it('deactivates rather than deletes, so a 2023 course stays explainable', () => {
    const external = registerInstructor({ instructorId: 'i-2', externalName: NAME });

    if (!external.ok) throw new Error(external.error.reason);

    const inactive = deactivateInstructor(external.value);

    expect(inactive.ok).toBe(true);
    if (!inactive.ok) return;
    expect(inactive.value.active).toBe(false);
    expect(deactivateInstructor(inactive.value).ok).toBe(false);
  });
});
