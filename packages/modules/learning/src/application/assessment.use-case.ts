import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { recordResult } from '../domain/assessment.js';
import { isEnrolmentClosed, type AssessmentOutcome } from '../domain/learning-vocabulary.js';
import { currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * Recording what an assessor saw — and the calculation this product refused to invent.
 *
 * The specification names five assessment kinds and the sentence "assessments measure learning
 * progress only". It defines **no scoring formula, no pass threshold, no weighting, no rounding, no
 * retake policy and no attempt limit**. So an authorized assessor records an outcome, and that
 * outcome is the fact.
 *
 * `rawMark` and `rawMarkScale` are the tenant's own text, stored verbatim. **Nothing in this module
 * reads them**: no query orders by them, no completion rule consults them, no view totals them, and
 * `hasPassedRequiredAssessments` is a presence test over outcomes rather than a calculation over
 * marks. **Aggregate scoring is `NOT VERIFIED`** — not approximated, not partially built.
 *
 * **A result is insert-only.** A correction is a new result on the day it was made; the store offers
 * no update and the trigger refuses one. What an assessor recorded is a thing that happened, and an
 * editable result would make every completion that depended on it unverifiable afterwards.
 */

export interface RecordAssessmentResultCommand extends Command {
  readonly commandName: 'learning.record-assessment-result';
  readonly assessmentId: string;
  readonly enrolmentId: string;
  readonly outcome: AssessmentOutcome;
  /** The tenant's own mark, kept as typed. Never parsed, compared, thresholded or totalled. */
  readonly rawMark?: string;
  readonly rawMarkScale?: string;
  readonly assessedOn: string;
  readonly notes?: string;
}

export interface AssessmentResultIdentified {
  readonly resultId: string;
}

export const recordAssessmentResultHandler = (
  dependencies: LearningDependencies,
): CommandHandler<RecordAssessmentResultCommand, AssessmentResultIdentified> => ({
  commandName: 'learning.record-assessment-result',
  permission: LearningPermissions.assessmentRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const enrolment = await dependencies.stores.enrolments.byId(transaction, command.enrolmentId);

      if (enrolment === undefined) {
        return notFound<AssessmentResultIdentified>('learning_enrolment');
      }
      // An assessment recorded against a course somebody already finished, failed or left would
      // change the evidence behind a completion that has already been acted on.
      if (isEnrolmentClosed(enrolment.status)) {
        return refuseWith<AssessmentResultIdentified>('assessment-enrolment-closed');
      }

      const assessment = await dependencies.stores.assessments.byId(
        transaction,
        command.assessmentId,
      );

      if (assessment === undefined) {
        return notFound<AssessmentResultIdentified>('learning_assessment');
      }
      // The assessment must belong to the version this enrolment pinned. One from a later version
      // would let a syllabus change silently decide whether an older enrolment could complete.
      if (assessment.courseVersionId !== enrolment.courseVersionId) {
        return refuseWith<AssessmentResultIdentified>('assessment-version-mismatch');
      }

      const recorded = recordResult({
        resultId: uuidV7(),
        employmentId: enrolment.employmentId,
        assessedBy: currentActor(),
        recordedAt: dependencies.clock.now(),
        ...command,
      });

      if (!recorded.ok) return refusedBy<AssessmentResultIdentified>(recorded.error);

      await dependencies.stores.results.insert(transaction, recorded.value);
      return success({ resultId: recorded.value.resultId });
    }),
});
