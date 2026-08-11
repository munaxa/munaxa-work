import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  CYCLE_KINDS,
  GOAL_MEASUREMENTS,
  GOAL_SCOPES,
  GOAL_STATUSES,
} from '../domain/performance-vocabulary.js';
import {
  CIVIL_DATE,
  CODE,
  EXACT_INTEGER,
  LocalizedTextBody,
  MAX_BASIS_POINTS,
  MAX_SCORE_HUNDREDTHS,
  VersionedBody,
} from './performance.dto.js';

/**
 * The wire shapes for cycles and goals: what a review measures, and the work it measures.
 *
 * Every enumeration is **derived from the domain vocabulary rather than retyped**, so a status the
 * domain adds is a status this file offers and one it removes is a compile error here. A hand-typed
 * list is how an API comes to accept a value the domain has never heard of and answer 422 for what
 * looks like a valid request.
 *
 * **A civil date is `YYYY-MM-DD` on the wire and a `Date` at UTC midnight in the command.** The
 * conversion happens once, in `civil()`, and the controller destructures every date field out of
 * the body before spreading the rest — so a string that reached a command beside the `Date` meant
 * to replace it is a compile error rather than the Phase 8 defect a third time.
 *
 * **No shape here carries an actor.** The acting identity comes from the authenticated request
 * context and nowhere else; a body that could name its own author is a body that could name
 * somebody else's.
 */

/** A free-text field a person writes. Bounded so a request cannot be a denial of service. */
const TEXT = 4000;

export class CreateCycleBody {
  @ApiProperty({ example: 'annual-2026' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty()
  @IsUUID()
  public readonly reviewTemplateId!: string;

  @ApiProperty({ enum: CYCLE_KINDS })
  @IsIn(CYCLE_KINDS)
  public readonly kind!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE)
  public readonly periodStart!: string;

  @ApiProperty({ example: '2026-12-31' })
  @Matches(CIVIL_DATE)
  public readonly periodEnd!: string;

  @ApiPropertyOptional({ example: '2026-11-15' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly selfAssessmentDue?: string;

  @ApiPropertyOptional({ example: '2026-11-30' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly managerAssessmentDue?: string;

  @ApiPropertyOptional({ example: '2026-11-20' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly peerAssessmentDue?: string;

  @ApiPropertyOptional({ example: '2026-12-10' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly calibrationDue?: string;
}

/**
 * Who to enrol: a list of employments, or a unit Employment resolves.
 *
 * The list is bounded because an unbounded one is a request that runs for an hour. Enrolment is
 * re-runnable — an employment already enrolled is skipped rather than duplicated — so a caller with
 * more than this many splits the request rather than losing the ability to make it.
 */
export class EnrolParticipantsBody {
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  public readonly employmentIds?: readonly string[];

  @ApiPropertyOptional({ description: 'Enrol everybody Employment places in this unit.' })
  @IsOptional()
  @IsUUID()
  public readonly organizationUnitId?: string;
}

export class CreateGoalBody {
  @ApiProperty({ enum: GOAL_SCOPES })
  @IsIn(GOAL_SCOPES)
  public readonly scope!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly employmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly organizationUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly cycleId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly parentGoalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly goalCategoryId?: string;

  @ApiProperty({ example: 'Reduce payroll run time' })
  @IsString()
  @Length(1, 500)
  public readonly title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly description?: string;

  @ApiProperty({ enum: GOAL_MEASUREMENTS })
  @IsIn(GOAL_MEASUREMENTS)
  public readonly measurement!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  public readonly targetDescription?: string;

  @ApiProperty({ example: 2500, description: 'Basis points. 2500 is 25% of the cycle’s goals.' })
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly weightBasisPoints!: number;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(CIVIL_DATE)
  public readonly startDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  @Matches(CIVIL_DATE)
  public readonly dueDate!: string;

  /**
   * A document that evidences the goal, **confirmed to exist and nothing more**. Performance keeps
   * the identifier; it holds no filename, size, hash or URL, and there is no upload or download
   * route anywhere in this module.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly evidenceDocumentId?: string;
}

export class UpdateGoalBody extends VersionedBody {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  public readonly title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  public readonly targetDescription?: string;

  @ApiPropertyOptional({ example: 3000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly weightBasisPoints?: number;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly evidenceDocumentId?: string;
}

const MOVEABLE_GOAL_STATUSES = GOAL_STATUSES.filter(
  (status) => status !== 'achieved' && status !== 'missed' && status !== 'cancelled',
);

export class MoveGoalBody extends VersionedBody {
  @ApiProperty({ enum: MOVEABLE_GOAL_STATUSES })
  @IsIn(MOVEABLE_GOAL_STATUSES)
  public readonly status!: string;
}

export class RecordProgressBody extends VersionedBody {
  @ApiProperty({ example: 4500, description: 'Basis points. 4500 is 45% complete.' })
  @IsInt()
  @Min(0)
  @Max(MAX_BASIS_POINTS)
  public readonly progressBasisPoints!: number;

  /**
   * The measurement behind the percentage, **as a decimal string**.
   *
   * A string because the value is a `bigint`: a count of transactions, of bytes, of parts can exceed
   * 2^53, and a JSON number above that is not the number that was sent. Payroll carries monetary
   * amounts the same way for the same reason. A measurement that rounded on the wire would make the
   * key result unfalsifiable, which is the opposite of what a measurement is for.
   */
  @ApiPropertyOptional({ example: '9007199254740993' })
  @IsOptional()
  @Matches(EXACT_INTEGER)
  public readonly observedValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly evidenceDocumentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly keyResultId?: string;
}

export class CloseGoalBody extends VersionedBody {
  @ApiProperty({ enum: ['achieved', 'missed', 'cancelled'] })
  @IsIn(['achieved', 'missed', 'cancelled'])
  public readonly outcome!: string;

  @ApiPropertyOptional({ example: 400, description: 'Hundredths of a point.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SCORE_HUNDREDTHS)
  public readonly finalScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, TEXT)
  public readonly reason?: string;
}
