import { findingsFor } from './reconciliation.js';
import type {
  PerformanceStores,
  CalibrationDecisionStore,
  CalibrationSessionStore,
  FeedbackStore,
  ReconciliationStore,
  SnapshotStore,
  TalentPlacementStore,
} from './performance-ports.js';
import {
  ConstraintViolation,
  UNIQUE_VIOLATION,
  bumped,
  expectVersion,
  heldOr,
  paged,
  type Tables,
} from './in-memory-tables.js';

/**
 * Calibration, placements, feedback, snapshots and reconciliation.
 *
 * Three of these offer insert-and-read and no update at all, which is the interface half of the
 * immutability the triggers enforce: a calibration decision, a snapshot and a piece of feedback are
 * each a record of something that already happened.
 */

const calibrationSessionsStore = (tables: Tables): CalibrationSessionStore => ({
  byId: (_transaction, id) => Promise.resolve(tables.calibrationSessions.get(id)),
  forCycle: (_transaction, cycleId) =>
    Promise.resolve(
      [...tables.calibrationSessions.values()].filter((session) => session.cycleId === cycleId),
    ),
  insert: (_transaction, state) => {
    tables.calibrationSessions.set(state.calibrationSessionId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr(
      'calibrationSessions',
      tables.calibrationSessions.get(state.calibrationSessionId),
    );

    expectVersion('calibrationSessions', held, expected);
    tables.calibrationSessions.set(state.calibrationSessionId, bumped(state));
    return Promise.resolve();
  },
});

const calibrationDecisionsStore = (tables: Tables): CalibrationDecisionStore => ({
  forSession: (_transaction, sessionId) =>
    Promise.resolve(
      tables.calibrationDecisions.filter((decision) => decision.calibrationSessionId === sessionId),
    ),
  forReview: (_transaction, reviewId) =>
    Promise.resolve(
      tables.calibrationDecisions.filter((decision) => decision.reviewId === reviewId),
    ),
  insert: (_transaction, state) => {
    const duplicate = tables.calibrationDecisions.some(
      (decision) =>
        decision.calibrationSessionId === state.calibrationSessionId &&
        decision.reviewId === state.reviewId,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.calibrationDecisions.push(state);
    return Promise.resolve();
  },
});

const placementsStore = (tables: Tables): TalentPlacementStore => ({
  forCycle: (_transaction, cycleId) =>
    Promise.resolve(
      [...tables.placements.values()].filter((placement) => placement.cycleId === cycleId),
    ),
  forReview: (_transaction, reviewId) =>
    Promise.resolve(
      [...tables.placements.values()].find((placement) => placement.reviewId === reviewId),
    ),
  insert: (_transaction, state) => {
    const duplicate = [...tables.placements.values()].some(
      (placement) =>
        placement.cycleId === state.cycleId && placement.employmentId === state.employmentId,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.placements.set(state.talentPlacementId, state);
    return Promise.resolve();
  },
  update: (_transaction, state, expected) => {
    const held = heldOr('placements', tables.placements.get(state.talentPlacementId));

    expectVersion('placements', held, expected);
    tables.placements.set(state.talentPlacementId, bumped(state));
    return Promise.resolve();
  },
});

const feedbackStore = (tables: Tables): FeedbackStore => ({
  byId: (_transaction, id) =>
    Promise.resolve(tables.withdrawnFeedback.has(id) ? undefined : tables.feedback.get(id)),
  search: (_transaction, filters, page) => {
    const matched = [...tables.feedback.values()].filter(
      (entry) =>
        !tables.withdrawnFeedback.has(entry.feedbackId) &&
        (filters.subjectEmploymentId === undefined ||
          entry.subjectEmploymentId === filters.subjectEmploymentId) &&
        (filters.authorEmploymentId === undefined ||
          entry.authorEmploymentId === filters.authorEmploymentId) &&
        (filters.relatedReviewId === undefined ||
          entry.relatedReviewId === filters.relatedReviewId) &&
        (filters.subjectEmploymentIdsIn === undefined ||
          filters.subjectEmploymentIdsIn.includes(entry.subjectEmploymentId)),
    );

    return Promise.resolve(paged(matched, page));
  },
  insert: (_transaction, state) => {
    tables.feedback.set(state.feedbackId, state);
    return Promise.resolve();
  },
  // A soft delete. The text is left exactly as written; only its visibility changes.
  withdraw: (_transaction, id) => {
    tables.withdrawnFeedback.add(id);
    return Promise.resolve();
  },
});

const snapshotsStore = (tables: Tables): SnapshotStore => ({
  forReview: (_transaction, reviewId) =>
    Promise.resolve(
      [...tables.snapshots.values()].find((snapshot) => snapshot.reviewId === reviewId),
    ),
  insert: (_transaction, state) => {
    const duplicate = [...tables.snapshots.values()].some(
      (snapshot) => snapshot.reviewId === state.reviewId,
    );

    if (duplicate) throw new ConstraintViolation(UNIQUE_VIOLATION);
    tables.snapshots.set(state.reviewSnapshotId, state);
    return Promise.resolve();
  },
});

const reconciliationStore = (tables: Tables): ReconciliationStore => ({
  findings: (_transaction, cycleId) =>
    Promise.resolve(
      findingsFor({
        cycleId,
        cycles: [...tables.cycles.values()],
        reviews: [...tables.reviews.values()],
        templates: [...tables.templates.values()],
        components: tables.templateComponents,
        goals: [...tables.goals.values()],
        placements: [...tables.placements.values()],
      }),
    ),
});

export const outcomeStores = (
  tables: Tables,
): Pick<
  PerformanceStores,
  | 'calibrationSessions'
  | 'calibrationDecisions'
  | 'placements'
  | 'feedback'
  | 'snapshots'
  | 'reconciliation'
> => ({
  calibrationSessions: calibrationSessionsStore(tables),
  calibrationDecisions: calibrationDecisionsStore(tables),
  placements: placementsStore(tables),
  feedback: feedbackStore(tables),
  snapshots: snapshotsStore(tables),
  reconciliation: reconciliationStore(tables),
});
