import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  concludeCalibration,
  moveCalibration,
  recordCalibrationDecision,
  scheduleCalibration,
} from '../domain/calibration.js';
import { applyCalibration } from '../domain/review.js';
import { recordPlacement } from '../domain/talent-placement.js';
import { currentActor, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { scaleBandFor } from './scoring.service.js';
import type { CalibrationStatus } from '../domain/performance-vocabulary.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Calibration, and the nine-box placement that follows a completed review.
 *
 * **A calibration decision never overwrites what was calculated.** It records the original score and
 * rating alongside the calibrated ones, with the actor, the moment and the reason; the review's
 * effective score moves and its calculated score does not. That is the seventh approved scoring
 * decision, and both halves are written in one transaction so neither can exist without the other.
 *
 * **Nobody calibrates their own review.** The check needs the subject's employment, which is on a
 * different row from the decision, so no check constraint can express it — it lives in the
 * aggregate, is given the deciding actor's employment by this handler, and is asserted again at the
 * HTTP edge in the later checkpoint.
 *
 * **A reason is mandatory and `system:auto-approval` is refused.** A rating changed in a meeting
 * with nothing recorded about why is a rating nobody can defend to the person it belongs to.
 */

export interface ScheduleCalibrationCommand extends Command {
  readonly commandName: 'performance.schedule-calibration';
  readonly cycleId: string;
  readonly code: string;
  readonly name: { readonly en: string; readonly ar: string };
  readonly organizationUnitId?: string;
  readonly scheduledFor?: Date;
  readonly facilitator?: string;
}

export interface CalibrationIdentified {
  readonly calibrationSessionId: string;
}

export const scheduleCalibrationHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<ScheduleCalibrationCommand, CalibrationIdentified> => ({
  commandName: 'performance.schedule-calibration',
  permission: PerformancePermissions.calibrate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const cycle = await dependencies.stores.cycles.byId(transaction, command.cycleId);

      if (cycle === undefined) return notFound<CalibrationIdentified>('performance_cycle');

      const scheduled = scheduleCalibration({ calibrationSessionId: uuidV7(), ...command });

      if (!scheduled.ok) return refusedBy<CalibrationIdentified>(scheduled.error);

      await dependencies.stores.calibrationSessions.insert(transaction, scheduled.value);
      return success({ calibrationSessionId: scheduled.value.calibrationSessionId });
    }),
});

export interface MoveCalibrationCommand extends Command {
  readonly commandName: 'performance.move-calibration';
  readonly calibrationSessionId: string;
  readonly expectedVersion: number;
  readonly status: CalibrationStatus;
}

export const moveCalibrationHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<MoveCalibrationCommand, CalibrationIdentified> => ({
  commandName: 'performance.move-calibration',
  permission: PerformancePermissions.calibrate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.calibrationSessions.byId(
        transaction,
        command.calibrationSessionId,
      );

      if (held === undefined) {
        return notFound<CalibrationIdentified>('performance_calibration_session');
      }
      // Concluding carries an actor. Routing it through the generic move would conclude a session
      // with nobody's name against it.
      if (command.status === 'concluded') {
        return refuseWith<CalibrationIdentified>('calibration-use-conclude-command');
      }

      const moved = moveCalibration(held, command.status, dependencies.clock.now());

      if (!moved.ok) return refusedBy<CalibrationIdentified>(moved.error);

      await dependencies.stores.calibrationSessions.update(
        transaction,
        { ...moved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ calibrationSessionId: held.calibrationSessionId });
    }),
});

export interface RecordCalibrationDecisionCommand extends Command {
  readonly commandName: 'performance.record-calibration-decision';
  readonly calibrationSessionId: string;
  readonly reviewId: string;
  readonly expectedReviewVersion: number;
  readonly calibratedScore: number;
  readonly calibratedRatingLevelId: string;
  readonly reason: string;
  /** The deciding person's employment, so calibrating one's own review can be refused. */
  readonly decidedByEmploymentId?: string;
}

export interface CalibrationDecisionRecorded {
  readonly calibrationDecisionId: string;
  readonly originalScore?: number;
  readonly calibratedScore: number;
}

export const recordCalibrationDecisionHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RecordCalibrationDecisionCommand, CalibrationDecisionRecorded> => ({
  commandName: 'performance.record-calibration-decision',
  permission: PerformancePermissions.calibrate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const session = await dependencies.stores.calibrationSessions.byId(
        transaction,
        command.calibrationSessionId,
      );

      if (session === undefined) {
        return notFound<CalibrationDecisionRecorded>('performance_calibration_session');
      }

      const review = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (review === undefined) return notFound<CalibrationDecisionRecorded>('performance_review');

      const scale = await scaleBandFor(dependencies, transaction, review.ratingScaleId);

      if (scale === undefined) {
        return refuseWith<CalibrationDecisionRecorded>('review-scale-missing');
      }

      const held = await dependencies.stores.calibrationDecisions.forSession(
        transaction,
        command.calibrationSessionId,
      );

      if (held.some((decision) => decision.reviewId === command.reviewId)) {
        return refuseWith<CalibrationDecisionRecorded>('calibration-decision-already-recorded');
      }

      const decision = recordCalibrationDecision(session, review, scale, {
        calibrationDecisionId: uuidV7(),
        ...command,
        decidedAt: dependencies.clock.now(),
        decidedBy: currentActor(),
      });

      if (!decision.ok) return refusedBy<CalibrationDecisionRecorded>(decision.error);

      const applied = applyCalibration(review, scale, {
        score: command.calibratedScore,
        ratingLevelId: command.calibratedRatingLevelId,
      });

      if (!applied.ok) return refusedBy<CalibrationDecisionRecorded>(applied.error);

      // Both, in one transaction. A calibrated review with no decision behind it would be a rating
      // somebody changed with no record of who or why.
      await dependencies.stores.calibrationDecisions.insert(transaction, decision.value);
      await dependencies.stores.reviews.update(
        transaction,
        { ...applied.value, version: review.version },
        command.expectedReviewVersion,
      );
      return success({
        calibrationDecisionId: decision.value.calibrationDecisionId,
        calibratedScore: decision.value.calibratedScore,
        ...(decision.value.originalScore === undefined
          ? {}
          : { originalScore: decision.value.originalScore }),
      });
    }),
});

export interface ConcludeCalibrationCommand extends Command {
  readonly commandName: 'performance.conclude-calibration';
  readonly calibrationSessionId: string;
  readonly expectedVersion: number;
}

export const concludeCalibrationHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<ConcludeCalibrationCommand, CalibrationIdentified> => ({
  commandName: 'performance.conclude-calibration',
  permission: PerformancePermissions.calibrate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.calibrationSessions.byId(
        transaction,
        command.calibrationSessionId,
      );

      if (held === undefined) {
        return notFound<CalibrationIdentified>('performance_calibration_session');
      }

      const concluded = concludeCalibration(held, currentActor(), dependencies.clock.now());

      if (!concluded.ok) return refusedBy<CalibrationIdentified>(concluded.error);

      await dependencies.stores.calibrationSessions.update(
        transaction,
        { ...concluded.value, version: held.version },
        command.expectedVersion,
      );
      return success({ calibrationSessionId: held.calibrationSessionId });
    }),
});

export interface RecordPlacementCommand extends Command {
  readonly commandName: 'performance.record-placement';
  readonly reviewId: string;
  readonly potentialBand: number;
  readonly rationale?: string;
}

export interface PlacementRecorded {
  readonly talentPlacementId: string;
  readonly boxCode: string;
}

/**
 * The nine-box placement, recorded against a completed review.
 *
 * **Published as a recommendation and pushed nowhere.** It changes no employment, moves no salary
 * and triggers no promotion; Career & Succession may pull it when Phase 15 exists (D-17, AD-005).
 * The performance band is derived from the review's own rating rather than typed, so a placement
 * cannot disagree with the review it came from.
 */
export const recordPlacementHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RecordPlacementCommand, PlacementRecorded> => ({
  commandName: 'performance.record-placement',
  permission: PerformancePermissions.talentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const review = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (review === undefined) return notFound<PlacementRecorded>('performance_review');

      const existing = await dependencies.stores.placements.forReview(
        transaction,
        command.reviewId,
      );

      if (existing !== undefined)
        return refuseWith<PlacementRecorded>('placement-already-recorded');

      const scale = await scaleBandFor(dependencies, transaction, review.ratingScaleId);

      if (scale === undefined) return refuseWith<PlacementRecorded>('review-scale-missing');

      const placed = recordPlacement(review, scale, {
        talentPlacementId: uuidV7(),
        ...command,
        placedAt: dependencies.clock.now(),
        placedBy: currentActor(),
      });

      if (!placed.ok) return refusedBy<PlacementRecorded>(placed.error);

      await dependencies.stores.placements.insert(transaction, placed.value);
      return success({
        talentPlacementId: placed.value.talentPlacementId,
        boxCode: placed.value.boxCode,
      });
    }),
});
