import { describe, expect, it } from 'vitest';
import type {
  AssignmentView,
  CertificationView,
  CourseView,
  EnrolmentView,
  MandatoryRuleView,
  PathView,
} from '@work/learning/contracts';

import {
  ASSIGNMENT_ACTIONS,
  CERTIFICATION_ACTIONS,
  COURSE_ACTIONS,
  ENROLMENT_ACTIONS,
  PATH_ACTIONS,
  assignmentActionsFor,
  assignmentWithheldBecause,
  certificationActionsFor,
  certificationWithheldBecause,
  courseActionsFor,
  courseWithheldBecause,
  enrolmentActionsFor,
  enrolmentWithheldBecause,
  pathActionsFor,
  pathWithheldBecause,
  ruleActionsFor,
} from './lifecycle';
import { civil, count, exactMark } from './exact';

/**
 * Which actions each state names, and — more importantly — which it never names.
 *
 * These are usability rules, not authorization, and the tests say so by testing both directions:
 * an action offered in a state the API accepts, and an action **absent** in every state, because
 * the API has no route for it at all.
 */

const aCourse = (overrides: Partial<CourseView> = {}): CourseView => ({
  courseId: '01930000-0000-7000-8000-000000000001',
  code: 'fire-safety',
  name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
  delivery: 'classroom',
  status: 'published',
  currentVersionId: '01930000-0000-7000-8000-000000000002',
  versionCount: 1,
  version: 2,
  ...overrides,
});

const aPath = (overrides: Partial<PathView> = {}): PathView => ({
  pathId: '01930000-0000-7000-8000-000000000003',
  code: 'induction',
  name: { en: 'Induction', ar: 'التعريف' },
  kind: 'role_based',
  status: 'draft',
  stepCount: 1,
  version: 1,
  ...overrides,
});

const aRule = (overrides: Partial<MandatoryRuleView> = {}): MandatoryRuleView => ({
  mandatoryRuleId: '01930000-0000-7000-8000-000000000004',
  courseId: '01930000-0000-7000-8000-000000000001',
  name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
  kind: 'safety',
  audience: 'everybody',
  effectiveFrom: '2024-01-01',
  recurrenceMonths: 12,
  dueWithinDays: 30,
  active: true,
  version: 1,
  ...overrides,
});

const anAssignment = (overrides: Partial<AssignmentView> = {}): AssignmentView => ({
  assignmentId: '01930000-0000-7000-8000-000000000005',
  employmentId: '01930000-0000-7000-8000-000000000006',
  courseId: '01930000-0000-7000-8000-000000000001',
  source: 'mandatory_rule',
  status: 'assigned',
  overdue: false,
  assignedBy: 'user:learning-hr',
  version: 1,
  ...overrides,
});

const anEnrolment = (overrides: Partial<EnrolmentView> = {}): EnrolmentView => ({
  enrolmentId: '01930000-0000-7000-8000-000000000007',
  employmentId: '01930000-0000-7000-8000-000000000006',
  courseId: '01930000-0000-7000-8000-000000000001',
  courseVersionId: '01930000-0000-7000-8000-000000000002',
  status: 'enrolled',
  version: 1,
  ...overrides,
});

const aCertificate = (overrides: Partial<CertificationView> = {}): CertificationView => ({
  certificationId: '01930000-0000-7000-8000-000000000008',
  employmentId: '01930000-0000-7000-8000-000000000006',
  title: 'Fire safety',
  source: 'learning_completion',
  status: 'active',
  issuedOn: '2026-08-12',
  validUntil: '2027-08-12',
  validity: 'valid',
  issuedBy: 'user:learning-hr',
  version: 1,
  ...overrides,
});

describe('the catalogue', () => {
  it('offers nothing on an archived course, and says why', () => {
    expect(courseActionsFor(aCourse({ status: 'archived' })).size).toBe(0);
    expect(courseWithheldBecause(aCourse({ status: 'archived' }))).toBe(
      'learning.withheld.courseArchived',
    );
  });

  it('does not offer to define an assessment on a course with no version to attach it to', () => {
    // Built by omission rather than by `currentVersionId: undefined`: with
    // `exactOptionalPropertyTypes`, a key present and undefined is not the same as an absent key,
    // and the fixture must produce the shape the API actually sends for a course with no version.
    const { currentVersionId: _unpublished, ...draft } = aCourse({
      status: 'draft',
      versionCount: 0,
    });

    expect(courseActionsFor(draft).has('defineAssessment')).toBe(false);
    // Publishing is still offered: that is how it gets a version in the first place.
    expect(courseActionsFor(draft).has('publish')).toBe(true);
  });

  it('does not offer to publish a path with nothing in it', () => {
    const empty = aPath({ stepCount: 0 });

    expect(pathActionsFor(empty).has('publish')).toBe(false);
    expect(pathWithheldBecause(empty)).toBe('learning.withheld.pathEmpty');
    // Adding a course is offered, because that is the way out of the state.
    expect(pathActionsFor(empty).has('addStep')).toBe(true);
  });

  it('does not offer to publish a path that is already published', () => {
    expect(pathActionsFor(aPath({ status: 'published' })).has('publish')).toBe(false);
  });
});

describe('requirements and records', () => {
  it('offers nothing on a retired requirement', () => {
    expect(ruleActionsFor(aRule({ active: false })).size).toBe(0);
    expect(ruleActionsFor(aRule()).has('reconcile')).toBe(true);
  });

  it('treats satisfied, waived and cancelled alike: all endings', () => {
    for (const status of ['satisfied', 'waived', 'cancelled']) {
      expect([status, assignmentActionsFor(anAssignment({ status })).size]).toEqual([status, 0]);
      expect(assignmentWithheldBecause(anAssignment({ status }))).toBe(
        'learning.withheld.assignmentClosed',
      );
    }
  });

  it('offers issuance on a completed enrolment and no way to edit it', () => {
    const completed = anEnrolment({ status: 'completed', completedOn: '2026-08-12' });

    expect([...enrolmentActionsFor(completed)]).toEqual(['issue']);
    expect(enrolmentWithheldBecause(completed)).toBe('learning.withheld.enrolmentCompleted');
  });

  it('does not offer to record a result against an enrolment nobody has started', () => {
    expect(enrolmentActionsFor(anEnrolment()).has('recordResult')).toBe(false);
    expect(enrolmentActionsFor(anEnrolment({ status: 'in_progress' })).has('recordResult')).toBe(
      true,
    );
  });

  it('offers nothing on an enrolment that ended without a completion', () => {
    for (const status of ['failed', 'withdrawn']) {
      expect([status, enrolmentActionsFor(anEnrolment({ status })).size]).toEqual([status, 0]);
    }
  });

  it('does not offer to revoke a certificate that is already gone', () => {
    expect(certificationActionsFor(aCertificate({ status: 'revoked' })).size).toBe(0);
    expect(certificationWithheldBecause(aCertificate({ status: 'superseded' }))).toBe(
      'learning.withheld.certificationSuperseded',
    );
    expect([...certificationActionsFor(aCertificate())]).toEqual(['revoke']);
  });
});

describe('the actions this product does not have', () => {
  /**
   * The one assertion that would catch somebody adding a control the API cannot honour.
   *
   * `satisfy` and `supersede` are the two that a learning product plausibly offers and this one
   * deliberately does not: an assignment is satisfied by evidence, and superseding is what issuing
   * the next certificate does. Naming either would offer to close a compliance obligation with
   * nothing behind it.
   */
  it('names no satisfy, supersede, score or schedule action in any vocabulary', () => {
    const every = [
      ...COURSE_ACTIONS,
      ...PATH_ACTIONS,
      ...ASSIGNMENT_ACTIONS,
      ...ENROLMENT_ACTIONS,
      ...CERTIFICATION_ACTIONS,
    ].map((action) => action.toLowerCase());

    for (const forbidden of ['satisfy', 'supersede', 'score', 'schedule', 'upload', 'download']) {
      expect([forbidden, every.some((action) => action.includes(forbidden))]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it('reaches satisfaction only through enrolling, never directly', () => {
    const open = assignmentActionsFor(anAssignment());

    expect(open.has('enrol')).toBe(true);
    expect([...open]).not.toContain('satisfy');
  });
});

describe('the values nothing here is allowed to convert', () => {
  it('renders a mark exactly as the assessor wrote it', () => {
    expect(exactMark('18.50')).toBe('18.50');
    // The regression this guards against, stated so the reason cannot be edited away by accident.
    expect(String(Number('18.50'))).not.toBe('18.50');
  });

  it('renders a civil date exactly as the domain stored it', () => {
    expect(civil('2026-08-12')).toBe('2026-08-12');
    expect(civil(undefined)).toBe('—');
  });

  it('renders a count without a locale separator that an export would not carry', () => {
    expect(count(4000)).toBe('4000');
    expect(count(undefined)).toBe('—');
  });
});
