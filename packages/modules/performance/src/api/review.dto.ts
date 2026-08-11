import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ASSIGNMENT_STATUSES,
  EXCLUSION_REASONS,
  FEEDBACK_KINDS,
  FEEDBACK_VISIBILITIES,
  REVIEWER_ROLES,
  REVIEW_STATUSES,
  TALENT_BANDS,
} from '../domain/performance-vocabulary.js';
import {
  CIVIL_DATE,
  CODE,
  LocalizedTextBody,
  MAX_SCORE_HUNDREDTHS,
  VersionedBody,
} from './performance.dto.js';

/**
 * The wire shapes for reviews, assessments, calibration, the nine-box and feedback.
 *
 * The same three rules as `goal.dto.ts`: enumerations derived from the domain vocabulary, civil
 * dates as `YYYY-MM-DD`, and **no actor in any body**. Two shapes are worth reading for what they
 * deliberately lack — `RecordCalibrationDecisionBody` has no field for the calculated score, and
 * `GiveFeedbackBody.visibility` offers no `anonymous` value.
 */

/** A free-text field a person writes. Bounded so a request cannot be a denial of service. */
const TEXT = 4000;

const MOVEABLE_REVIEW_STATUSES = REVIEW_STATUSES.filter(
  (status) => status !== 'completed' && status !== 'archived',
);

/**
 * `completed` and `archived` are excluded here as well as refused by the handler.
 *
 * Both are terminal and both carry an actor the generic move has nowhere to record. Completion in
 * particular is **a named human's act**: it has its own route, its own permission and its own check
 * constraint refusing `system:auto-approval`, and a review that reached `completed` through this
 * route would have arrived there with nobody's name against it.
 */
export class MoveReviewBody extends VersionedBody {
  @ApiProperty({ enum: MOVEABLE_REVIEW_STATUSES })
  @IsIn(MOVEABLE_REVIEW_STATUSES)
  public readonly status!: string;
}

export class AssignReviewerBody {
  @ApiProperty()
  @IsUUID()
  public readonly reviewerEmploymentId!: string;

  @ApiProperty({ enum: REVIEWER_ROLES })
  @IsIn(REVIEWER_ROLES)
  public readonly role!: string;
}

export class RespondToAssignmentBody extends VersionedBody {
  @ApiProperty({ enum: ASSIGNMENT_STATUSES })
  @IsIn(ASSIGNMENT_STATUSES)
  public readonly status!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly declineReason?: string;
}

/**
 * Starting an assessment.
 *
 * `assessorEmploymentId` names **whose opinion this is**, not who is signed in — a self assessment
 * is the subject's, a manager assessment the manager's, a peer assessment the invited reviewer's.
 * It is not proof of anything: the caller's authority comes from the permission they hold and, for
 * a peer, from an invitation the handler looks up. A caller naming somebody else's employment is
 * refused there, not here.
 */
export class StartAssessmentBody {
  @ApiProperty({ enum: ['self', 'manager', 'peer', 'direct_report', 'skip_level'] })
  @IsIn(REVIEWER_ROLES)
  public readonly assessmentKind!: string;

  @ApiProperty()
  @IsUUID()
  public readonly assessorEmploymentId!: string;
}

/**
 * One line of an assessment.
 *
 * A line either carries a score or says why it does not. `exclusionReason` is the recorded form of
 * D-6's fifth decision — missing or incomplete work leaves the denominator and the exclusion is
 * kept with its reason, rather than being silently scored zero, which would rate somebody down for
 * work nobody assessed.
 */
export class RecordAssessmentItemBody {
  @ApiProperty({ enum: ['goal', 'competency'] })
  @IsIn(['goal', 'competency'])
  public readonly itemKind!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly goalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly competencyId?: string;

  @ApiPropertyOptional({ example: 400, description: 'Hundredths of a point.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly ratingLevelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly comment?: string;

  @ApiPropertyOptional({ enum: EXCLUSION_REASONS })
  @IsOptional()
  @IsIn(EXCLUSION_REASONS)
  public readonly exclusionReason?: string;
}

export class SubmitAssessmentBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly overallComment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly developmentAreas?: string;
}

export class ScheduleCalibrationBody {
  @ApiProperty()
  @IsUUID()
  public readonly cycleId!: string;

  @ApiProperty({ example: 'engineering' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly organizationUnitId?: string;

  @ApiPropertyOptional({ example: '2026-12-10' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly scheduledFor?: string;

  @ApiPropertyOptional({ example: 'user:hr-director' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  public readonly facilitator?: string;
}

export class MoveCalibrationBody extends VersionedBody {
  @ApiProperty({ enum: ['scheduled', 'in_session'] })
  @IsIn(['scheduled', 'in_session'])
  public readonly status!: string;
}

/**
 * A calibrated rating.
 *
 * **There is no field here for the calculated score.** A calibration records a new number beside the
 * engine's, never over it: the original is what makes the moderation auditable years later, and a
 * database trigger refuses an update that changes it. `reason` is mandatory for the same reason —
 * a rating moved in a meeting with no explanation is a rating nobody can defend.
 */
export class RecordCalibrationDecisionBody {
  @ApiProperty()
  @IsUUID()
  public readonly reviewId!: string;

  @ApiProperty({ example: 2, description: 'The review version the decision was taken against.' })
  @IsInt()
  @Min(1)
  public readonly expectedReviewVersion!: number;

  @ApiProperty({ example: 350, description: 'Hundredths of a point.' })
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly calibratedScore!: number;

  @ApiProperty()
  @IsUUID()
  public readonly calibratedRatingLevelId!: string;

  @ApiProperty({ example: 'Moderated against the peer group.' })
  @IsString()
  @Length(1, TEXT)
  public readonly reason!: string;

  @ApiPropertyOptional({ description: 'The employment of the person who decided, where recorded.' })
  @IsOptional()
  @IsUUID()
  public readonly decidedByEmploymentId?: string;
}

export class RecordPlacementBody {
  @ApiProperty({
    enum: TALENT_BANDS,
    description: 'The potential axis. Performance comes from the review.',
  })
  @IsIn([...TALENT_BANDS])
  public readonly potentialBand!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly rationale?: string;
}

/**
 * A piece of feedback.
 *
 * `visibility` offers **no `anonymous` value and never will**: every row carries `created_by`, the
 * correlation identifier records the request, and row-level security is tenant-scoped. Hiding an
 * author in a screen is a presentation choice, not anonymity (D-12).
 */
export class GiveFeedbackBody {
  @ApiProperty()
  @IsUUID()
  public readonly subjectEmploymentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly authorEmploymentId!: string;

  @ApiProperty({ enum: FEEDBACK_KINDS })
  @IsIn(FEEDBACK_KINDS)
  public readonly kind!: string;

  @ApiProperty({ enum: FEEDBACK_VISIBILITIES })
  @IsIn(FEEDBACK_VISIBILITIES)
  public readonly visibility!: string;

  @ApiProperty()
  @IsString()
  @Length(1, TEXT)
  public readonly body!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly relatedGoalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly relatedReviewId?: string;
}

export class WithdrawFeedbackBody {
  @ApiProperty()
  @IsUUID()
  public readonly authorEmploymentId!: string;
}
