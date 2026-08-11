import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';
import { recordItem, startAssessment, submitAssessment } from '../domain/assessment.js';
import { currentActor, forbidden, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { scaleBandFor } from './scoring.service.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Assessments: started, filled in as a draft, submitted — and then frozen.
 *
 * **The assessor is resolved from the authenticated context, never from the command.** A command
 * carrying its own author is a command anybody can use to file an assessment under a colleague's
 * name, and the column that records who said what would then record nothing worth having.
 *
 * **A reviewer who was not invited cannot submit.** Every assessment except the manager's and the
 * subject's own must point at a reviewer assignment that names the assessor and is still pending —
 * which is what makes a 360° panel a panel rather than an open comment box.
 *
 * **Scoring is a separate command.** It is not a side effect of submitting an assessment, because a
 * manager submitting is one decision and a review being rated is another, and collapsing them would
 * make it impossible to see a score that had been computed and then examined before completion.
 */

export interface StartAssessmentCommand extends Command {
  readonly commandName: 'performance.start-assessment';
  readonly reviewId: string;
  readonly assessmentKind: string;
  /** The assessor's employment. Distinct from the *actor*: one is a person, the other a login. */
  readonly assessorEmploymentId: string;
}

export interface AssessmentIdentified {
  readonly assessmentId: string;
}

/**
 * Starting an assessment, and the authorization that decides whether it may be started at all.
 *
 * `assessorEmploymentId` is supplied, and that is deliberate rather than an oversight: this product
 * has no principal-to-employment resolution (ADR-0032), so there is no way to derive it. It is
 * therefore **checked, not trusted** — a manager kind must match the review's manager, and a
 * multi-rater kind must match a pending invitation. Anything else is refused, so a supplied
 * identifier buys nothing an invitation did not already grant.
 */
export const startAssessmentHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<StartAssessmentCommand, AssessmentIdentified> => ({
  commandName: 'performance.start-assessment',
  permission: PerformancePermissions.assess,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const review = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (review === undefined) return notFound<AssessmentIdentified>('performance_review');
      if (review.completedAt !== undefined) {
        return refuseWith<AssessmentIdentified>('review-already-completed');
      }

      const assignments = await dependencies.stores.reviewers.forReview(
        transaction,
        command.reviewId,
      );
      const authorized = authorizationFor(review, assignments, command);

      if (!authorized.permitted) {
        return forbidden<AssessmentIdentified>(authorized.permission);
      }

      const existing = await dependencies.stores.assessments.forAssessor(
        transaction,
        command.reviewId,
        command.assessorEmploymentId,
        command.assessmentKind,
      );

      if (existing !== undefined) return success({ assessmentId: existing.assessmentId });

      const started = startAssessment({
        assessmentId: uuidV7(),
        reviewId: command.reviewId,
        assessorEmploymentId: command.assessorEmploymentId,
        assessmentKind: command.assessmentKind,
        ...(authorized.reviewerAssignmentId === undefined
          ? {}
          : { reviewerAssignmentId: authorized.reviewerAssignmentId }),
      });

      if (!started.ok) return refusedBy<AssessmentIdentified>(started.error);

      await dependencies.stores.assessments.insert(transaction, started.value);
      return success({ assessmentId: started.value.assessmentId });
    }),
});

interface ReviewFacts {
  readonly employmentId: string;
  readonly managerEmploymentId?: string;
}

interface AssignmentFacts {
  readonly reviewerAssignmentId: string;
  readonly reviewerEmploymentId: string;
  readonly role: string;
  readonly status: string;
}

/**
 * Whether this assessor may write this kind of assessment, and which invitation permits it.
 *
 * A discriminated verdict rather than a bare string. An earlier version returned the assignment
 * identifier on success and a permission name on refusal — both strings, which meant every invited
 * reviewer was refused by the caller's own type check. The refusals suite found it, and the shape
 * is now one a caller cannot misread.
 *
 * The refusal names a permission rather than a reason because the caller already knows the review
 * exists — they were told about it — so "forbidden" discloses nothing further.
 */
type Verdict =
  | { readonly permitted: true; readonly reviewerAssignmentId?: string }
  | { readonly permitted: false; readonly permission: string };

const authorizationFor = (
  review: ReviewFacts,
  assignments: readonly AssignmentFacts[],
  command: StartAssessmentCommand,
): Verdict => {
  if (command.assessmentKind === 'self') {
    return command.assessorEmploymentId === review.employmentId
      ? { permitted: true }
      : { permitted: false, permission: PerformancePermissions.assess };
  }
  if (command.assessmentKind === 'manager') {
    return command.assessorEmploymentId === review.managerEmploymentId
      ? { permitted: true }
      : { permitted: false, permission: PerformancePermissions.assess };
  }

  const invited = assignments.find(
    (assignment) =>
      assignment.reviewerEmploymentId === command.assessorEmploymentId &&
      assignment.role === command.assessmentKind &&
      assignment.status !== 'declined',
  );

  return invited === undefined
    ? { permitted: false, permission: PerformancePermissions.assessPeer }
    : { permitted: true, reviewerAssignmentId: invited.reviewerAssignmentId };
};

export interface RecordAssessmentItemCommand extends Command {
  readonly commandName: 'performance.record-assessment-item';
  readonly assessmentId: string;
  readonly itemKind: 'goal' | 'competency';
  readonly goalId?: string;
  readonly competencyId?: string;
  readonly score?: number;
  readonly ratingLevelId?: string;
  readonly comment?: string;
  readonly exclusionReason?: string;
}

export const recordAssessmentItemHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RecordAssessmentItemCommand, AssessmentIdentified> => ({
  commandName: 'performance.record-assessment-item',
  permission: PerformancePermissions.assess,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const assessment = await dependencies.stores.assessments.byId(
        transaction,
        command.assessmentId,
      );

      if (assessment === undefined) return notFound<AssessmentIdentified>('performance_assessment');

      const review = await dependencies.stores.reviews.byId(transaction, assessment.reviewId);
      const scale =
        review === undefined
          ? undefined
          : await scaleBandFor(dependencies, transaction, review.ratingScaleId);

      if (scale === undefined) return refuseWith<AssessmentIdentified>('review-scale-missing');

      const held = await dependencies.stores.assessments.itemsFor(
        transaction,
        command.assessmentId,
      );
      const existing = held.find(
        (item) =>
          item.itemKind === command.itemKind &&
          (command.itemKind === 'goal'
            ? item.goalId === command.goalId
            : item.competencyId === command.competencyId),
      );
      const recorded = recordItem(
        assessment,
        { assessmentItemId: existing?.assessmentItemId ?? uuidV7(), ...command },
        scale,
      );

      if (!recorded.ok) return refusedBy<AssessmentIdentified>(recorded.error);

      await dependencies.stores.assessments.upsertItem(transaction, recorded.value);
      return success({ assessmentId: assessment.assessmentId });
    }),
});

export interface SubmitAssessmentCommand extends Command {
  readonly commandName: 'performance.submit-assessment';
  readonly assessmentId: string;
  readonly expectedVersion: number;
  readonly overallComment?: string;
  readonly strengths?: string;
  readonly developmentAreas?: string;
}

export const submitAssessmentHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<SubmitAssessmentCommand, AssessmentIdentified> => ({
  commandName: 'performance.submit-assessment',
  permission: PerformancePermissions.assess,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.assessments.byId(transaction, command.assessmentId);

      if (held === undefined) return notFound<AssessmentIdentified>('performance_assessment');

      const items = await dependencies.stores.assessments.itemsFor(
        transaction,
        command.assessmentId,
      );
      const submitted = submitAssessment(held, items, {
        ...command,
        submittedAt: dependencies.clock.now(),
        submittedBy: currentActor(),
      });

      if (!submitted.ok) return refusedBy<AssessmentIdentified>(submitted.error);

      await dependencies.stores.assessments.update(
        transaction,
        { ...submitted.value, version: held.version },
        command.expectedVersion,
      );
      await markResponded(dependencies, transaction, held);
      return success({ assessmentId: held.assessmentId });
    }),
});

type Transaction = Parameters<Parameters<PerformanceDependencies['unitOfWork']['execute']>[0]>[0];

/** An invitation answered. Kept in step with the submission, in the same transaction. */
const markResponded = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  assessment: { readonly reviewerAssignmentId?: string },
): Promise<void> => {
  if (assessment.reviewerAssignmentId === undefined) return;

  const assignment = await dependencies.stores.reviewers.byId(
    transaction,
    assessment.reviewerAssignmentId,
  );

  if (assignment === undefined || assignment.status !== 'pending') return;

  await dependencies.stores.reviewers.update(
    transaction,
    {
      ...assignment,
      status: 'submitted',
      respondedAt: dependencies.clock.now(),
      version: assignment.version,
    },
    assignment.version,
  );
};
