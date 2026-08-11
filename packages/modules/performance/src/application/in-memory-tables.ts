import { ConcurrencyException } from '@work/kernel';

import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type { CalibrationDecisionState, CalibrationSessionState } from '../domain/calibration.js';
import type {
  CompetencyFrameworkState,
  CompetencyLevelState,
  CompetencyState,
} from '../domain/competency-framework.js';
import type { CycleState } from '../domain/cycle.js';
import type { FeedbackState } from '../domain/feedback.js';
import type { GoalProgressState, GoalState } from '../domain/goal.js';
import type { RatingLevelState, RatingScaleState } from '../domain/rating-scale.js';
import type { ReviewSnapshotState } from '../domain/review-snapshot.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { ReviewState, ReviewerAssignmentState } from '../domain/review.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type { ComponentScoreRecord, GoalCategoryState, Page, Paged } from './performance-ports.js';

/**
 * The tables the in-memory stores share, and the two production rules they all keep.
 *
 * **The optimistic version is checked on every update**, exactly as a real
 * `update ... where version = $expected` affects zero rows on a mismatch. That is what makes the
 * completion race testable before any database exists, and it is why these fakes raise the same
 * SQLSTATE a repository would translate rather than quietly succeeding.
 *
 * **A fake more permissive than the database hides the defects these suites exist to find**, so the
 * unique constraints the schema carries are enforced here too: one review per employment per cycle,
 * one assessment per assessor per kind, one calibration decision per session per review, one
 * placement per employment per cycle, one snapshot per review.
 */

/** The SQLSTATE a real unique index raises, so the later repository's translation is exercised too. */
export class ConstraintViolation extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

export const UNIQUE_VIOLATION = '23505';

export const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

/**
 * The optimistic check, raising exactly what `Repository.updateRow` raises.
 *
 * `ConcurrencyException` rather than a constraint violation, because that is what the real
 * repository throws when its `where version = $expected` matches no row — and every module since
 * Phase 2 lets it travel to the edge, where it becomes a 409. A fake that returned a quiet failure
 * instead would let a losing writer look like a successful one.
 */
export const expectVersion = (
  table: string,
  held: { readonly version: number },
  expected: number,
): void => {
  if (held.version !== expected) throw new ConcurrencyException(table, expected, held.version);
};

export const bumped = <TState extends { readonly version: number }>(state: TState): TState => ({
  ...state,
  version: state.version + 1,
});

/** Reads the row an update targets, refusing the same way a vanished row would. */
export const heldOr = <TState>(table: string, candidate: TState | undefined): TState => {
  if (candidate === undefined) throw new ConcurrencyException(table, -1, -1);
  return candidate;
};

export interface Tables {
  readonly scales: Map<string, RatingScaleState>;
  readonly scaleLevels: RatingLevelState[];
  readonly frameworks: Map<string, CompetencyFrameworkState>;
  readonly competencies: CompetencyState[];
  readonly competencyLevels: CompetencyLevelState[];
  readonly goalCategories: Map<string, GoalCategoryState>;
  readonly templates: Map<string, ReviewTemplateState>;
  readonly templateComponents: TemplateComponentState[];
  readonly goals: Map<string, GoalState>;
  readonly goalProgress: GoalProgressState[];
  readonly cycles: Map<string, CycleState>;
  readonly reviews: Map<string, ReviewState>;
  readonly reviewers: Map<string, ReviewerAssignmentState>;
  readonly assessments: Map<string, AssessmentState>;
  readonly assessmentItems: Map<string, AssessmentItemState>;
  readonly componentScores: ComponentScoreRecord[];
  readonly calibrationSessions: Map<string, CalibrationSessionState>;
  readonly calibrationDecisions: CalibrationDecisionState[];
  readonly placements: Map<string, TalentPlacementState>;
  readonly feedback: Map<string, FeedbackState>;
  readonly withdrawnFeedback: Set<string>;
  readonly snapshots: Map<string, ReviewSnapshotState>;
}

export const emptyTables = (): Tables => ({
  scales: new Map(),
  scaleLevels: [],
  frameworks: new Map(),
  competencies: [],
  competencyLevels: [],
  goalCategories: new Map(),
  templates: new Map(),
  templateComponents: [],
  goals: new Map(),
  goalProgress: [],
  cycles: new Map(),
  reviews: new Map(),
  reviewers: new Map(),
  assessments: new Map(),
  assessmentItems: new Map(),
  componentScores: [],
  calibrationSessions: new Map(),
  calibrationDecisions: [],
  placements: new Map(),
  feedback: new Map(),
  withdrawnFeedback: new Set(),
  snapshots: new Map(),
});
