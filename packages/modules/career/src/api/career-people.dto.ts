import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
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

import { ACKNOWLEDGERS } from '../domain/development.js';
import {
  DEVELOPMENT_CATEGORIES,
  DEVELOPMENT_ITEM_KINDS,
  DEVELOPMENT_ITEM_STATUSES,
  DEVELOPMENT_PLAN_STATUSES,
  MAX_READINESS_ORDINAL,
  MAX_SUCCESSOR_RANK,
  MOBILITY_KINDS,
  STORED_MOBILITY_STATUSES,
} from '../domain/career-vocabulary.js';

import {
  CIVIL_DATE,
  CODE,
  LocalizedTextBody,
  NOTES,
  REASON,
  TITLE,
  VersionedBody,
} from './career.dto.js';

/**
 * The shapes that name **a person**, rather than a piece of configuration.
 *
 * Split from `career.dto.ts` along that seam: a path, a plan's own dates and a pool are things a
 * tenant defines, while everything here records a judgement somebody made about a named colleague —
 * who could succeed a director, who is ready, what somebody agreed to do, and where somebody might
 * move next. Every rule in `career.dto.ts`'s file note applies unchanged; the two that bite hardest
 * on these shapes are worth repeating.
 *
 * **`employmentId` is a subject and never a credential.** It says who the record is *about*. The
 * acting identity comes from the authenticated request context, and no shape below carries an actor
 * (ADR-0032).
 *
 * **Nothing here is computed.** A rank and an ordinal are small whole numbers a human chose, bounded
 * by the domain's own constants; there is no score, no band and no percentage anywhere (ADR-0074).
 */

// ------------------------------------------------------------------------------------------------
// Succession
// ------------------------------------------------------------------------------------------------

export class CreateSuccessionPlanBody {
  @ApiProperty()
  @IsUUID()
  public readonly positionId!: string;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Nothing fires on this day (D-16).' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly reviewOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly notes?: string;
}

export class NominateSuccessorBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly readinessLevelId?: string;

  @ApiPropertyOptional({ example: 1, maximum: MAX_SUCCESSOR_RANK })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SUCCESSOR_RANK)
  public readonly rank?: number;
}

export class WithdrawSuccessorBody extends VersionedBody {
  @ApiProperty({ example: 'Took a role in another group' })
  @IsString()
  @IsNotEmpty()
  @Length(1, REASON)
  public readonly reason!: string;
}

// ------------------------------------------------------------------------------------------------
// Readiness
// ------------------------------------------------------------------------------------------------

export class DefineReadinessLevelBody {
  @ApiProperty({ example: 'ready-now' })
  @Matches(CODE)
  public readonly code!: string;

  @ApiProperty({ type: LocalizedTextBody })
  @ValidateNested()
  @Type(() => LocalizedTextBody)
  public readonly name!: LocalizedTextBody;

  @ApiProperty({ example: 1, maximum: MAX_READINESS_ORDINAL })
  @IsInt()
  @Min(1)
  @Max(MAX_READINESS_ORDINAL)
  public readonly ordinal!: number;
}

/**
 * A statement somebody makes about somebody else. Never a computed score (ADR-0074).
 *
 * There is no evidence document on this shape and no route to attach one: Career's schema has
 * nowhere to persist the identifier, so accepting one would be validation theatre. Evidence-document
 * capability is `NOT VERIFIED`.
 */
export class RecordReadinessBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty()
  @IsUUID()
  public readonly readinessLevelId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly positionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly successionPlanId?: string;

  @ApiProperty({ example: '2026-06-01' })
  @Matches(CIVIL_DATE)
  public readonly assessedOn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly rationale?: string;
}

// ------------------------------------------------------------------------------------------------
// Development
// ------------------------------------------------------------------------------------------------

export class CreateDevelopmentPlanBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly careerPlanId?: string;

  @ApiPropertyOptional({ example: '2026' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  public readonly cycleLabel?: string;

  @ApiProperty({ example: '2026-03-05' })
  @Matches(CIVIL_DATE)
  public readonly startedOn!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly targetDate?: string;
}

export class MoveDevelopmentPlanBody extends VersionedBody {
  @ApiProperty({ enum: DEVELOPMENT_PLAN_STATUSES })
  @IsIn(DEVELOPMENT_PLAN_STATUSES)
  public readonly to!: string;
}

/**
 * Which party acknowledged, and the day they did.
 *
 * `party` is a fact somebody records, **not an assertion about who is calling** (D-9). There is no
 * principal-to-employment resolution in this repository, so an API that inferred "you are the
 * employee, therefore this is the employee's acknowledgement" would be inventing one.
 */
export class AcknowledgeDevelopmentPlanBody extends VersionedBody {
  @ApiProperty({ enum: ACKNOWLEDGERS })
  @IsIn(ACKNOWLEDGERS)
  public readonly party!: string;

  @ApiProperty({ example: '2026-03-10' })
  @Matches(CIVIL_DATE)
  public readonly on!: string;
}

export class AddDevelopmentItemBody {
  @ApiProperty({ enum: DEVELOPMENT_CATEGORIES })
  @IsIn(DEVELOPMENT_CATEGORIES)
  public readonly category!: string;

  @ApiProperty({ enum: DEVELOPMENT_ITEM_KINDS })
  @IsIn(DEVELOPMENT_ITEM_KINDS)
  public readonly kind!: string;

  @ApiProperty({ example: 'Lead the year-end close' })
  @IsString()
  @IsNotEmpty()
  @Length(1, TITLE)
  public readonly title!: string;

  /**
   * Learning's identifier, required for a `course` item and refused on any other.
   *
   * Confirmed as *this person's* assignment through `assignmentIsFor(employmentId, assignmentId)` —
   * the employment comes from the plan, never from the request — so naming a colleague's real
   * assignment is refused rather than accepted.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly learningAssignmentId?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly targetDate?: string;
}

export class MoveDevelopmentItemBody extends VersionedBody {
  @ApiProperty({ enum: DEVELOPMENT_ITEM_STATUSES })
  @IsIn(DEVELOPMENT_ITEM_STATUSES)
  public readonly to!: string;
}

// ------------------------------------------------------------------------------------------------
// Mobility
// ------------------------------------------------------------------------------------------------

/** A suggestion. Accepting one moves nobody, and there is no port through which it could (ADR-0072). */
export class RecommendMoveBody {
  @ApiProperty()
  @IsUUID()
  public readonly employmentId!: string;

  @ApiProperty({ enum: MOBILITY_KINDS })
  @IsIn(MOBILITY_KINDS)
  public readonly kind!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly targetPositionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  public readonly targetUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly rationale?: string;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Expiry is derived, never stored.' })
  @IsOptional()
  @Matches(CIVIL_DATE)
  public readonly validUntil?: string;
}

export class DecideMoveBody extends VersionedBody {
  @ApiProperty({
    enum: STORED_MOBILITY_STATUSES,
    description: '`expired` is absent deliberately: it is derived from a stated day (D-13).',
  })
  @IsIn(STORED_MOBILITY_STATUSES)
  public readonly to!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, NOTES)
  public readonly note?: string;
}
